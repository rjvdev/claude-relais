#!/usr/bin/python3 -I
"""Fabrique un .vsix (archive zip) à partir du dossier vscode/, sans Node ni vsce.  Usage : vsix.py <dossier> <sortie.vsix>"""
import json
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

src, sortie = Path(sys.argv[1]), Path(sys.argv[2])
p = json.loads((src / "package.json").read_text())
types = """<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension=".json" ContentType="application/json"/><Default Extension=".js" ContentType="application/javascript"/>
<Default Extension=".md" ContentType="text/markdown"/><Default Extension=".vsixmanifest" ContentType="text/xml"/>
</Types>"""
manifeste = f"""<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="{p['name']}" Version="{p['version']}" Publisher="{p['publisher']}"/>
    <DisplayName>{escape(p['displayName'])}</DisplayName>
    <Description xml:space="preserve">{escape(p['description'])}</Description>
    <Categories>Other</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="{p['engines']['vscode']}"/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="{','.join(p.get('extensionKind', ['workspace']))}"/>
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Dependencies/>
  <Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets>
</PackageManifest>"""
with zipfile.ZipFile(sortie, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", types)
    z.writestr("extension.vsixmanifest", manifeste)
    for f in sorted(src.rglob("*")):
        if f.is_file():
            z.write(f, f"extension/{f.relative_to(src)}")
print(sortie)
