// Takes a look at the desk from the front camera (ASC-47; one look at a time
// since ASC-55).
//
// The camera does not stream. `look` starts the capture session, waits for
// exposure to settle, watches for a couple of seconds, stops the session and
// hands back three numbers: a held face count, a motion score and how many
// frames it examined. JS calls it every 15s; between looks the camera is off,
// which is the whole battery saving — a running session costs the same
// whether or not anything reads its frames.
//
// The privacy promise is structural: frames go from AVFoundation straight into
// Apple Vision and a 32x24 brightness grid on this queue and are dropped.
// Nothing is stored, nothing is encoded, and only those numbers leave this
// class. No Expo import, so it can be type-checked on its own.

import AVFoundation
import UIKit
import Vision

final class PresenceDetector: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  enum Status: String {
    case ok, stopped, busy, interrupted, denied, unavailable, error
  }

  struct Look {
    var status: Status
    var faces = 0
    var motion = 0.0
    var frames = 0
    var message: String? = nil

    var dictionary: [String: Any] {
      var d: [String: Any] = ["status": status.rawValue, "faces": faces, "motion": motion, "frames": frames]
      if let message { d["message"] = message }
      return d
    }
  }

  private let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "eva.presence.session")
  private let videoQueue = DispatchQueue(label: "eva.presence.video")
  private var configured = false  // sessionQueue only

  // The look in progress. Touched only on videoQueue.
  private var pending: ((Look) -> Void)?
  private var generation = 0
  private var settleSec = 1.0
  private var windowSec = 2.0
  private var firstFrameAt: CFTimeInterval?
  private var reference: [Float]?
  private var maxMotion = 0.0
  private var counts: [Int] = []
  // Read on videoQueue, written on main. A stale read costs one frame.
  private var orientation: CGImagePropertyOrientation = .upMirrored

  private var observers: [NSObjectProtocol] = []

  override init() {
    super.init()
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: AVCaptureSession.wasInterruptedNotification, object: session, queue: nil) { [weak self] note in
      let reason = (note.userInfo?[AVCaptureSessionInterruptionReasonKey] as? NSNumber)
        .flatMap { AVCaptureSession.InterruptionReason(rawValue: $0.intValue) }
      self?.videoQueue.async { self?.finish(Look(status: .interrupted, message: reason.map(Self.describe))) }
    })
    observers.append(center.addObserver(forName: AVCaptureSession.runtimeErrorNotification, object: session, queue: nil) { [weak self] note in
      let err = note.userInfo?[AVCaptureSessionErrorKey] as? NSError
      self?.videoQueue.async { self?.finish(Look(status: .error, message: err?.localizedDescription)) }
    })
  }

  deinit {
    observers.forEach(NotificationCenter.default.removeObserver)
  }

  /// One look: camera on, `settleMs` for exposure to settle (its drift would
  /// read as motion), `windowMs` of watching, camera off. `completion` runs
  /// exactly once, on any queue. Never prompts: JS asks for camera permission
  /// first, when no microphone is open.
  func look(settleMs: Int, windowMs: Int, completion: @escaping (Look) -> Void) {
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
      completion(Look(status: .denied))
      return
    }
    refreshOrientation()
    videoQueue.async {
      if self.pending != nil {
        completion(Look(status: .busy))
        return
      }
      self.generation += 1
      let gen = self.generation
      self.pending = completion
      self.settleSec = max(0, Double(settleMs) / 1000)
      self.windowSec = max(0.2, Double(windowMs) / 1000)
      self.firstFrameAt = nil
      self.reference = nil
      self.maxMotion = 0
      self.counts = []

      self.sessionQueue.async {
        if !self.configured {
          if let failure = self.configure() {
            self.videoQueue.async { if self.generation == gen { self.finish(Look(status: failure)) } }
            return
          }
          self.configured = true
        }
        if !self.session.isRunning { self.session.startRunning() }
      }

      // A session that never delivers a frame must not leave the look hanging.
      let deadline = self.settleSec + self.windowSec + 4
      self.videoQueue.asyncAfter(deadline: .now() + deadline) {
        guard self.generation == gen, self.pending != nil else { return }
        if self.counts.isEmpty {
          self.finish(Look(status: .error, message: "no frames from the camera"))
        } else {
          self.finish(self.result())
        }
      }
    }
  }

  /// Abort any look in progress and make sure the camera is off.
  func stop() {
    videoQueue.sync { finish(Look(status: .stopped)) }
    sessionQueue.sync {
      if session.isRunning { session.stopRunning() }
    }
  }

  /// videoQueue only. Turns the camera off and answers the look, once.
  private func finish(_ look: Look) {
    guard let completion = pending else { return }
    pending = nil
    generation += 1
    firstFrameAt = nil
    reference = nil
    sessionQueue.async {
      if self.session.isRunning { self.session.stopRunning() }
    }
    completion(look)
  }

  /// videoQueue only. The look so far, as an answer.
  ///
  /// The face count is *held*: the largest count seen in at least half the
  /// frames, so someone walking past the chair in one frame is not a visitor.
  private func result() -> Look {
    let sorted = counts.sorted(by: >)
    let held = sorted.isEmpty ? 0 : sorted[(sorted.count - 1) / 2]
    return Look(status: .ok, faces: held, motion: maxMotion, frames: counts.count)
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

    // Five frames a second is plenty for a two-second look; the camera
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
    guard pending != nil, let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let now = CACurrentMediaTime()
    // Settling is timed from the first frame, not from the call: starting the
    // session takes a variable few hundred milliseconds.
    guard let first = firstFrameAt else {
      firstFrameAt = now
      return
    }
    if now - first < settleSec { return }

    // Motion: how much of the frame differs from the first settled one. Against
    // a fixed reference rather than the previous frame, so slow movement adds
    // up over the window instead of hiding under the per-frame threshold.
    if let grid = Self.lumaGrid(pixels) {
      if let ref = reference {
        maxMotion = max(maxMotion, Self.changedShare(ref, grid))
      } else {
        reference = grid
      }
    }

    // The phone sits in landscape, and Vision misses faces lying on their
    // side. Try the way the screen faces first, then the opposite landscape:
    // it survives the phone being turned round.
    let primary = orientation
    var count = faces(in: pixels, orientation: primary)
    if count == 0 { count = faces(in: pixels, orientation: Self.flipped(primary)) }
    counts.append(count)

    if now - first >= settleSec + windowSec { finish(result()) }
  }

  // MARK: - Motion

  private static let gridW = 32
  private static let gridH = 24

  /// Mean brightness of each cell of a 32x24 grid over the luma plane,
  /// sampling every fourth pixel each way. Small and coarse on purpose: it is
  /// enough to see someone move and far too little to see who.
  static func lumaGrid(_ pixels: CVPixelBuffer) -> [Float]? {
    CVPixelBufferLockBaseAddress(pixels, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixels, .readOnly) }
    guard CVPixelBufferGetPlaneCount(pixels) > 0, let base = CVPixelBufferGetBaseAddressOfPlane(pixels, 0) else { return nil }
    let width = CVPixelBufferGetWidthOfPlane(pixels, 0)
    let height = CVPixelBufferGetHeightOfPlane(pixels, 0)
    let rowBytes = CVPixelBufferGetBytesPerRowOfPlane(pixels, 0)
    guard width > 0, height > 0 else { return nil }
    let luma = base.assumingMemoryBound(to: UInt8.self)
    var sums = [Float](repeating: 0, count: gridW * gridH)
    var ns = [Float](repeating: 0, count: gridW * gridH)
    let step = 4
    for y in stride(from: 0, to: height, by: step) {
      let gy = min(gridH - 1, y * gridH / height)
      let row = luma + y * rowBytes
      for x in stride(from: 0, to: width, by: step) {
        let i = gy * gridW + min(gridW - 1, x * gridW / width)
        sums[i] += Float(row[x])
        ns[i] += 1
      }
    }
    return zip(sums, ns).map { $1 > 0 ? $0 / $1 : 0 }
  }

  /// Share of cells (0-1) that changed between two grids. `b` is scaled to
  /// `a`'s overall brightness first, so exposure still drifting a little
  /// doesn't count; a cell changes when it moves by more than sensor noise
  /// plus a tenth of the scene's mean.
  static func changedShare(_ a: [Float], _ b: [Float]) -> Double {
    guard a.count == b.count, !a.isEmpty else { return 0 }
    let meanA = a.reduce(0, +) / Float(a.count)
    let meanB = b.reduce(0, +) / Float(b.count)
    let scale: Float = meanB > 1 ? meanA / meanB : 1
    let threshold = 10 + 0.1 * meanA
    var changed = 0
    for i in a.indices where abs(a[i] - b[i] * scale) > threshold { changed += 1 }
    return Double(changed) / Double(a.count)
  }

  // MARK: - Faces

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
