Option Explicit
Dim shell, files, root, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
If Not files.FileExists(root & "\assets\catalog.json") Then
  MsgBox "Run Set up BotDrafts.cmd first, then open this launcher again.", vbInformation, "BotDrafts Helper"
  WScript.Quit 1
End If
shell.CurrentDirectory = root
command = "node """ & root & "\server.mjs"" --open"
shell.Run command, 0, False
