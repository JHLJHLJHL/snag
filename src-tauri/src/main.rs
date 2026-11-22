#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args()
        .skip(1)
        .any(|a| a == "--native-host" || a.starts_with("chrome-extension://"))
    {
        if let Err(e) = streamdrop_core::bridge::native_host() {
            eprintln!("{e}");
        }
        return;
    }
    streamdrop_core::desktop::run();
}
