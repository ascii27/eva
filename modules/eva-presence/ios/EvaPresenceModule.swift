// The Expo face of PresenceDetector (ASC-47): two calls and two events.
// Everything interesting is in PresenceDetector.swift.

import ExpoModulesCore

public class EvaPresenceModule: Module {
  private let detector = PresenceDetector()

  public func definition() -> ModuleDefinition {
    Name("EvaPresence")

    Events("onFaces", "onStatus")

    OnCreate {
      detector.onFaces = { [weak self] count in
        self?.sendEvent("onFaces", ["faces": count])
      }
      detector.onStatus = { [weak self] status, message in
        var body: [String: Any] = ["status": status.rawValue]
        if let message { body["message"] = message }
        self?.sendEvent("onStatus", body)
      }
    }

    /// Resolves "running", "denied" or "unavailable". Never prompts for permission.
    AsyncFunction("start") { (intervalMs: Int) -> String in
      self.detector.start(intervalMs: intervalMs).rawValue
    }

    AsyncFunction("stop") {
      self.detector.stop()
    }

    Function("isRunning") {
      self.detector.isRunning
    }

    OnDestroy {
      self.detector.stop()
    }
  }
}
