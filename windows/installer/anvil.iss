; Anvil - Windows installer (Inno Setup 6).
;
; Built by windows/tools/build_windows.py:
;     ISCC /DAppVersion=<version.json version> /DVersionInfoVersion=<its numeric form>
;          /DAppBuild=<frozen app build> anvil.iss
;
; The payload is the staged Electron tree at ..\stage\Anvil - the Electron runtime with
; resources\app\ holding the FROZEN app build. The build script proves that index.html inside the
; staged tree hashes to the sha pinned in version.json before this script ever runs.
;
; Per-user install (no UAC), Add/Remove entry, licence page (AGPL-3.0-or-later), silent-friendly
; (/VERYSILENT), and an uninstall that offers - never forces - removing your sessions, samples
; and installed packs.

#define AppName "Anvil"
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef AppBuild
  #define AppBuild "unknown"
#endif
; The exe's fixed version info takes digits only, so build_windows.py passes the numeric form
; of the version separately ("1.14.0" -> "1.14.0.0"). AppVersion / AppVerName keep the label the
; user sees; VersionInfoProductVersion is deliberately NOT set, so it defaults to AppVersion.
#ifndef VersionInfoVersion
  #define VersionInfoVersion "0.0.0.0"
#endif
#define AppPublisher "Modtech"
#define AppURL "https://moddys.net/anvil/"
#define ReleasesURL "https://moddys.net/moddys-downloads.html"
#define ExeName "Anvil.exe"

[Setup]
; Stable AppId for the life of the product - generated once for Anvil and pinned here; changing it
; would orphan every existing install (a new entry in Add/Remove and an uninstaller that no longer
; knows the old folder).
AppId={{DEDBE31C-DDB6-43DA-BBE5-11160C1883DD}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#ReleasesURL}
AppUpdatesURL={#ReleasesURL}
VersionInfoVersion={#VersionInfoVersion}
VersionInfoCompany={#AppPublisher}
VersionInfoDescription={#AppName} {#AppVersion} setup (app build {#AppBuild})
VersionInfoProductName={#AppName}
DefaultDirName={autopf}\Anvil
DefaultGroupName=Anvil
DisableProgramGroupPage=yes
LicenseFile=..\..\LICENSE
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\out
OutputBaseFilename=Anvil-{#AppVersion}-Setup
SetupIconFile=..\icons\anvil.ico
UninstallDisplayIcon={app}\{#ExeName}
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
AllowNoIcons=yes
CloseApplications=yes
RestartApplications=no
; The app keeps everything under %APPDATA%\Anvil - the installer never writes there, so upgrades
; over the top leave your sessions, samples and installed packs exactly where they were.
UsePreviousAppDir=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "..\stage\Anvil\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Anvil"; Filename: "{app}\{#ExeName}"
Name: "{autodesktop}\Anvil"; Filename: "{app}\{#ExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#ExeName}"; Description: "Launch Anvil"; Flags: nowait postinstall skipifsilent

[Code]
{ Uninstall: the app folder goes, your work stays unless you say otherwise. Sessions, samples,
  installed packs and settings live in %APPDATA%\Anvil - deleting a creative tool's saved work by
  default is not a thing a polite installer does. }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
  Keep: Integer;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    DataDir := ExpandConstant('{userappdata}\Anvil');
    if DirExists(DataDir) then
    begin
      Keep := MsgBox('Also delete your Anvil sessions, samples, installed packs and settings?' + #13#10#13#10 +
                     DataDir + #13#10#13#10 +
                     'Choose No to keep them (installing again picks up where you left off).',
                     mbConfirmation, MB_YESNO or MB_DEFBUTTON2);
      if Keep = IDYES then
        DelTree(DataDir, True, True, True);
    end;
  end;
end;
