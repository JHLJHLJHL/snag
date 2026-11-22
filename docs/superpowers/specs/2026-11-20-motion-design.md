# StreamDrop motion

Apply all six DesignBookmark references approved in chat: File drop, Loading to success,
Step progress, Segmented control, Morph island, and Copy button.

Preserve the light Astryx desktop workbench and actual queue behavior. Reuse Astryx's
accessible segmented control, stepper, spinner and progress bar. Adapt the references'
spring movement through short, interruptible Web Animations where native components
do not cover it; introduce no runtime dependency or demo autoplay.

- File drop: react to external video links over the main and small windows, then show
  real enqueue feedback. Unsupported file drags must not look accepted.
- Loading to success: show a compact spinner/check transition driven by queue status;
  downloading 100% and processing remain busy until the backend reports completed.
- Step progress: analysis, download, processing, completion in the selected inspector.
  Pause/failure/cancellation show the truthful current state rather than a success.
- Segmented control: visible video+audio / video / audio choices, preserving MP3 mode
  compatibility, format resets, disabled state and keyboard interaction.
- Morph island: morph content inside the existing 310 by 210 drop window; reflect
  real queue events, show brief completion feedback, and fit without scrolling.
- Copy button: confirm only after clipboard success, expose failures, reset and clean
  up its timer when unmounted.

Use existing tokens and component layout. Reduced motion removes spatial travel but
keeps feedback; cancel animations and timers on unmount. No engine, queue storage,
native-window dimensions, registration or theme changes are needed.

Approach: extend the current screen with a focused motion component module. A full
motion library or copying the demo's standalone HTML would add avoidable dependencies
and conflict with the Astryx component and theme rules.
