import UIKit
import Capacitor

// Apps built with the iOS 27 SDK must use the UIScene life cycle. The storyboard in Info.plist
// (UISceneStoryboardFile) still creates the window and the Capacitor view controller; this class
// takes over what AppDelegate used to do when the app came forward or opened a link.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    private var appDelegate: AppDelegate? {
        UIApplication.shared.delegate as? AppDelegate
    }

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // The app is white: match it, so nothing flashes behind the web view
        window?.backgroundColor = UIColor.white

        // The app was launched by a link
        if let url = connectionOptions.urlContexts.first?.url {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
        }
        if let activity = connectionOptions.userActivities.first {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
        }
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        // Reactivate audio session when coming to foreground
        appDelegate?.configureAudioSession()
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        // Reconfigure and reactivate audio session to ensure audio plays even in silent mode
        appDelegate?.configureAudioSession()
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        // Called when the app is opened with a URL while running
        guard let url = URLContexts.first?.url else { return }
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        // Called when the app is opened with an activity, including Universal Links
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }
}
