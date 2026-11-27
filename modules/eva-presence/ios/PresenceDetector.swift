// Counts faces in front of the desk iPhone (ASC-47).
//
// The privacy promise is structural: frames go from AVFoundation straight into
// Apple Vision on this queue and are dropped. Nothing is stored, nothing is
// encoded, and the only thing that leaves this class is an integer through
// `onFaces` — and only when it changes. No Expo import, so it can be
// type-checked on its own.

import AVFoundation
import UIKit
import Vision

final class PresenceDetector: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  enum Status: String {
    case running, stopped, interrupted, denied, unavailable, error
  }

  /// A new face count. Called on the video queue.
  var onFaces: ((Int) -> Void)?
  /// The capture session started, stopped, was interrupted, or failed.
  var onStatus: ((Status, String?) -> Void)?

  private let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "eva.presence.session")
  private let videoQueue = DispatchQueue(label: "eva.presence.video")
  private var configured = false

  // Touched only on videoQueue.
  private var intervalSec: Double = 1.0
  private var lastRun: CFTimeInterval = 0
  private var lastCount = -1
  // Read on videoQueue, written on main. A stale read costs one frame.
  private var orientation: CGImagePropertyOrientation = .upMirrored

  private var observers: [NSObjectProtocol] = []

  override init() {
    super.init()
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: AVCaptureSession.wasInterruptedNotification, object: session, queue: nil) { [weak self] note in
      let reason = (note.userInfo?[AVCaptureSessionInterruptionReasonKey] as? NSNumber)
        .flatMap { AVCaptureSession.InterruptionReason(rawValue: $0.intValue) }
      self?.onStatus?(.interrupted, reason.map(Self.describe))
    })
    observers.append(center.addObserver(forName: AVCaptureSession.interruptionEndedNotification, object: session, queue: nil) { [weak self] _ in
      self?.onStatus?(.running, nil)
    })
    observers.append(center.addObserver(forName: AVCaptureSession.runtimeErrorNotification, object: session, queue: nil) { [weak self] note in
      let err = note.userInfo?[AVCaptureSessionErrorKey] as? NSError
      self?.onStatus?(.error, err?.localizedDescription)
    })
  }

  deinit {
    observers.forEach(NotificationCenter.default.removeObserver)
  }

  var isRunning: Bool { session.isRunning }

  /// Start counting, checking at most once every `intervalMs`. Never prompts:
  /// JS asks for camera permission first, when no microphone is open.
  func start(intervalMs: Int) -> Status {
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else { return .denied }
    let interval = max(0.2, Double(intervalMs) / 1000)
    videoQueue.async {
      self.intervalSec = interval
      self.lastCount = -1  // the first result is always reported
    }
    refreshOrientation()
    var result: Status = .running
    sessionQueue.sync {
      if !configured {
        if let failure = configure() {
          result = failure
          return
        }
        configured = true
      }
      if !session.isRunning { session.startRunning() }
    }
    if result == .running { onStatus?(.running, nil) }
    return result
  }

  func stop() {
    sessionQueue.sync {
      if session.isRunning { session.stopRunning() }
    }
    onStatus?(.stopped, nil)
  }

  // MARK: - Capture

  private func configure() -> Status? {
    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front),
          let input = try? AVCaptureDeviceInput(device: device)
    else { return .unavailable }

    session.beginConfiguration()
    defer { session.commitConfiguration() }
    // Faces at desk distance need nothing like full resolution, and a small
    // frame keeps the detector and the battery cheap.
    session.sessionPreset = session.canSetSessionPreset(.vga640x480) ? .vga640x480 : .low
    guard session.canAddInput(input) else { return .unavailable }
    session.addInput(input)

    let output = AVCaptureVideoDataOutput()
    output.alwaysDiscardsLateVideoFrames = true
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
    output.setSampleBufferDelegate(self, queue: videoQueue)
    guard session.canAddOutput(output) else { return .unavailable }
    session.addOutput(output)

    // A few frames a second is plenty to throttle down from; the camera
    // doesn't need to run at 30.
    if (try? device.lockForConfiguration()) != nil {
      let fps = CMTime(value: 1, timescale: 5)
      if device.activeFormat.videoSupportedFrameRateRanges.contains(where: { $0.minFrameDuration <= fps && fps <= $0.maxFrameDuration }) {
        device.activeVideoMinFrameDuration = fps
        device.activeVideoMaxFrameDuration = fps
      }
      device.unlockForConfiguration()
    }
    return nil
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    let now = CACurrentMediaTime()
    guard now - lastRun >= intervalSec, let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    lastRun = now

    // The phone sits in landscape, and Vision misses faces lying on their
    // side. Try the way the screen faces first, then the opposite landscape:
    // cheap at one check a second, and it survives the phone being turned round.
    let primary = orientation
    var count = faces(in: pixels, orientation: primary)
    if count == 0 { count = faces(in: pixels, orientation: Self.flipped(primary)) }

    if count != lastCount {
      lastCount = count
      onFaces?(count)
    }
  }

  private func faces(in pixels: CVPixelBuffer, orientation: CGImagePropertyOrientation) -> Int {
    let request = VNDetectFaceRectanglesRequest()
    let handler = VNImageRequestHandler(cvPixelBuffer: pixels, orientation: orientation, options: [:])
    do {
      try handler.perform([request])
    } catch {
      return 0
    }
    return (request.results ?? []).filter { $0.confidence >= 0.5 }.count
  }

  // MARK: - Orientation

  /// The front camera's EXIF orientation for the current interface orientation
  /// (Apple's Vision face-tracking sample, with interface — not device —
  /// orientation, since UIInterfaceOrientation.landscapeLeft is
  /// UIDeviceOrientation.landscapeRight).
  func refreshOrientation() {
    DispatchQueue.main.async {
      let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
      switch scene?.effectiveGeometry.interfaceOrientation ?? .landscapeRight {
      case .landscapeRight: self.orientation = .downMirrored
      case .landscapeLeft: self.orientation = .upMirrored
      case .portraitUpsideDown: self.orientation = .rightMirrored
      default: self.orientation = .leftMirrored
      }
    }
  }

  private static func flipped(_ o: CGImagePropertyOrientation) -> CGImagePropertyOrientation {
    switch o {
    case .upMirrored: return .downMirrored
    case .downMirrored: return .upMirrored
    case .leftMirrored: return .rightMirrored
    case .rightMirrored: return .leftMirrored
    default: return o
    }
  }

  private static func describe(_ reason: AVCaptureSession.InterruptionReason) -> String {
    switch reason {
    case .videoDeviceInUseByAnotherClient: return "camera in use elsewhere"
    case .videoDeviceNotAvailableInBackground: return "app in background"
    case .videoDeviceNotAvailableWithMultipleForegroundApps: return "multitasking"
    case .videoDeviceNotAvailableDueToSystemPressure: return "system pressure"
    case .audioDeviceInUseByAnotherClient: return "audio in use"
    default: return "interrupted"
    }
  }
}
