; Inno Setup 6: o instalador do Deck (Fase 7 do plano). Sai em packaging\Output\Deck-Setup.exe.
; (Gravado em UTF-8 com BOM: assim o Inno Setup lê os acentos das mensagens certo.)
;
;   python -m PyInstaller packaging\deck.spec --noconfirm        (antes: o dist\Deck com o Deck.exe)
;   iscc /DAppVersion=0.9.0 "/DIconFile=%CD%\build\deck\deck.ico" packaging\installer.iss
;
; A versão vem de app/__init__.py (__version__): quem chama passa por /DAppVersion (a CI de versão lê de lá e
; confere com a tag). O ícone é o que o deck.spec grava na pasta de trabalho do PyInstaller (opcional; caminho
; completo, porque os relativos são lidos a partir da pasta deste arquivo, como o SourceDir abaixo).
;
; O que faz:
; - instala em Arquivos de Programas (só leitura: o config da pessoa fica em %APPDATA%\Deck, app/paths.py);
; - atalho no menu Iniciar, que abre o Deck na bandeja e o editor no navegador;
; - opção de iniciar com o Windows: o PRÓPRIO INSTALADOR grava a chave Run (o mesmo texto que o app grava,
;   winutil.autostart_command: "...\Deck.exe" --tray). Antes rodava `Deck.exe --autostart on`, e o Windows Defender
;   pôs o Deck.exe em quarentena (Behavior:Win32/Persistence.A!ml: um exe sem assinatura se registrando para abrir
;   com o Windows). Gravada pelo instalador, que é o caminho comum, o Deck.exe não faz isso sozinho. Fica no HKCU de
;   quem confirmou o UAC (o normal: a própria pessoa);
; - desinstalador: tira o "iniciar com o Windows" (se apontar para este Deck.exe) e pergunta se apaga os dados da
;   pessoa (%APPDATA%\Deck: config, histórico e backup; %LOCALAPPDATA%\D6Deck: logs e plugins instalados).
;   Sem resposta (desinstalação silenciosa), os dados ficam.

#ifndef AppVersion
  #error Passe a versão: iscc /DAppVersion=x.y.z (a de app/__init__.py)
#endif
#ifndef SourceDir
  #define SourceDir "..\dist\Deck"
#endif

[Setup]
AppId={{7C5641A3-E093-4753-9DA2-266EE6526E2F}
AppName=Deck
AppVersion={#AppVersion}
AppVerName=Deck {#AppVersion}
AppPublisher=Deck
VersionInfoVersion={#AppVersion}
VersionInfoProductName=Deck
VersionInfoDescription=Deck {#AppVersion} (Fifine AmpliGame D6)
DefaultDirName={autopf}\Deck
DefaultGroupName=Deck
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=Output
OutputBaseFilename=Deck-Setup
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
; o mesmo nome da instância única do app (winutil.single_instance): pede para fechar o Deck antes de trocar os
; arquivos
AppMutex=Local\D6Deck-single-instance
UninstallDisplayName=Deck
UninstallDisplayIcon={app}\Deck.exe
#ifdef IconFile
SetupIconFile={#IconFile}
#endif

[Languages]
Name: "pt_BR"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
pt_BR.AutoStart=Iniciar o Deck junto com o Windows
en.AutoStart=Start the Deck with Windows
pt_BR.OpenNow=Abrir o Deck agora
en.OpenNow=Open the Deck now
pt_BR.DeleteData=Apagar também os seus dados do Deck?%n%n%1%nconfig.yaml, histórico de versões e backup%n%n%2%nlogs e plugins instalados%n%nEscolha Não para manter (por exemplo, para instalar de novo depois).
en.DeleteData=Also delete your Deck data?%n%n%1%nconfig.yaml, version history and backup%n%n%2%nlogs and installed plugins%n%nChoose No to keep them (for example, to install again later).

[Tasks]
Name: "autostart"; Description: "{cm:AutoStart}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Deck"; Filename: "{app}\Deck.exe"; Parameters: "--tray --editor"; WorkingDir: "{app}"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "D6Deck"; ValueData: """{app}\Deck.exe"" --tray"; Tasks: autostart

[Run]
Filename: "{app}\Deck.exe"; Parameters: "--tray --editor"; Description: "{cm:OpenNow}"; Flags: postinstall nowait skipifsilent runasoriginaluser

[Code]
const
  RunKey = 'Software\Microsoft\Windows\CurrentVersion\Run';
  RunName = 'D6Deck';  { winutil.RUN_NAME }

{ Tira o "iniciar com o Windows" só se ele abre este Deck.exe (o de desenvolvimento, com o Python, fica). }
procedure RemoveAutostart;
var
  Value: String;
begin
  if RegQueryStringValue(HKCU, RunKey, RunName, Value) then
    if Pos(Lowercase(ExpandConstant('{app}\Deck.exe')), Lowercase(Value)) > 0 then
      RegDeleteValue(HKCU, RunKey, RunName);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Config, Data: String;
begin
  if CurUninstallStep = usUninstall then
    RemoveAutostart;
  if CurUninstallStep = usPostUninstall then
  begin
    Config := ExpandConstant('{userappdata}\Deck');
    Data := ExpandConstant('{localappdata}\D6Deck');
    if (DirExists(Config) or DirExists(Data)) and not UninstallSilent then
      if MsgBox(FmtMessage(CustomMessage('DeleteData'), [Config, Data]), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      begin
        DelTree(Config, True, True, True);
        DelTree(Data, True, True, True);
      end;
  end;
end;
