// The Expo face of PresenceDetector (ASC-47; polled since ASC-55): two calls
// and no events. Everything interesting is in PresenceDetector.swift.

import ExpoModulesCore

public class EvaPresenceModule: Module {
  private let detector = PresenceDetector()

  public func definition() -> ModuleDefinition {
    Name("EvaPresence")

    /// One look: resolves {status, faces, motion, frames, message?}. The
    /// camera is on only while it runs. Never prompts for permission.
    AsyncFunction("look") { (settleMs: Int, windowMs: Int, promise: Promise) in
      self.detector.look(settleMs: settleMs, windowMs: windowMs) { look in
        promise.resolve(look.dictionary)
      }
    }

    /// Aborts a look in progress (it resolves "stopped") and turns the camera off.
    AsyncFunction("stop") {
      self.detector.stop()
    }

    OnDestroy {
      self.detector.stop()
    }
  }
}
