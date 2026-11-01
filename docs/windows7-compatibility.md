# Windows 7 compatibility edition

This branch is the separate Windows 7 SP1 desktop distribution. Do not merge its Electron pin or build settings into the Windows 10/11 or macOS distribution.

- Electron is pinned to **22.3.27**, the last official 22.x release; Chromium 108 and Node 16.17.1.
- NSIS contains both ia32 and x64 archives and chooses the native architecture. The executable and all its native libraries must match that architecture.
- The Windows 10 installer guard has been replaced by the Windows 7 minimum guard **together with** the compatible runtime. Removing the guard from a modern runtime does not provide compatibility.
- Software rendering avoids reliance on hardware acceleration on older graphics drivers. Renderer sandbox, context isolation and disabled Node integration remain enabled. TLS verification is unchanged.
- RAW printer discovery uses PowerShell 2-compatible `New-Object PSObject -Property`. The WMI fallback remains available when Get-Printer/CIM are absent. Driver printing and receipt preparation remain the same as the main application.
- The legacy app never instantiates electron-updater or requests the modern update feed. Background checks do nothing; the manual menu opens the dedicated Windows 7 download section after a click. Website updates still load normally.
- Package identity and user-data location are unchanged to preserve printer settings. Install with MyDelivery closed. Existing Windows 10/11 installations are not automatically moved to this edition.

## Release procedure

Push to `fix/windows7-legacy` to run `.github/workflows/windows7.yml`. Download `mydelivery-windows7` only after all checks pass. Publish `MyDelivery-Windows7-Setup.exe` under a `win7-v...` prerelease, never latest, and never attach modern `latest.yml` metadata. This tag prefix does not trigger the modern release pipeline.

The Windows tests run on Server 2022, including native x86 execution through WOW64; they do **not** replace validation on a physical Windows 7 SP1 machine. Checks cover opening, reopening, installer repair, PE architecture, printer preferences and receipt/PDF rendering. No test sends an actual restaurant order or prints physical paper.

## Limitations

### Recovery screen (1.0.41)

Retry uses authenticated local IPC to navigate the existing main window. Repeated clicks are locked while loading, and recovery popups are denied/routed to that same window. Browser fallback is handled independently of navigation-event ordering. The screen shows the actual Chromium error code and differentiates certificate trust, certificate date, DNS, offline and timeout errors. No certificate verification is bypassed and no trust roots are installed by this release. A missing Windows trust chain still requires diagnosis/repair on the affected machine; the recovery change does not claim to repair it.

Electron 22 no longer receives security updates. This is a compatibility edition for legacy systems, not a supported security baseline. Windows 10/11 clients must continue to use the main installer. Windows 7 should have SP1, its applicable updates and valid HTTPS root certificates. Never disable certificate verification to work around missing system certificates.

Sources:
- https://www.electronjs.org/blog/windows-7-to-8-1-deprecation-notice
- https://releases.electronjs.org/release/v22.3.27
