!include "WinVer.nsh"
!macro customInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "O MyDelivery precisa do Windows 10 ou superior. Este instalador inclui 32 e 64 bits, mas nao e compativel com Windows 7, 8 ou 8.1. Atualize o Windows antes de instalar."
    Abort
  ${EndIf}
!macroend
