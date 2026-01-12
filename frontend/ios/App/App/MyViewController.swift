import UIKit
import Capacitor

class MyViewController: CAPBridgeViewController {
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        // Make webview background match app theme
        webView?.isOpaque = false
        webView?.backgroundColor = UIColor(red: 0.11, green: 0.098, blue: 0.09, alpha: 1.0)
        webView?.scrollView.backgroundColor = UIColor(red: 0.11, green: 0.098, blue: 0.09, alpha: 1.0)
        
        // Extend webview under safe areas
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
    }
    
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        
        // Ensure webview fills entire screen
        webView?.frame = view.bounds
    }
}
