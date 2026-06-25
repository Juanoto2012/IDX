!includeLogicLib
!insertmacro MUI_PAGE_DIRECTORY

Section
  ; Ensure directory selection page is shown
  ${IfNot} $INSTDIR == ${DEFAULT_INSTALLDIR}
    ; User can change the installation directory
  ${EndIf}
SectionEnd