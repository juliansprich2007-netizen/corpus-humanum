# Corpus Humanum

Anatomie auf Latein lernen: Knochen, Gelenke, Muskeln, Sehnen und Bänder in einem drehbaren 3D-Modell, mit Karteikarten, Abfrage und Lernfortschritt.

Die Website ist rein statisch (HTML, JavaScript, 3D-Daten) und braucht keinen Server-Code.

## Lokal starten

```bash
ruby -run -e httpd . -p 8765
```

Danach http://localhost:8765 öffnen.

## Veröffentlichen auf Render

Render → **New** → **Static Site** → dieses Repository wählen.
Build Command leer lassen, Publish Directory: `.`
Alternativ übernimmt Render die Einstellungen aus `render.yaml` (New → Blueprint).

## Quellen und Lizenzen

- 3D-Daten: **BodyParts3D, © The Database Center for Life Science, lizenziert unter CC Attribution 4.0 International** (https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html).
  Für diese Website auf Knochen, Muskeln, Knorpel, Bänder, Zähne und Haut reduziert und in ein kompaktes Format umgewandelt. Die Web-Aufbereitung stammt aus dem Projekt [ashemag/human-atlas](https://github.com/ashemag/human-atlas) (MIT-Lizenz).
- 3D-Darstellung: [three.js](https://threejs.org) (MIT) und [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) (MIT), geladen über jsDelivr.

Das Modell zeigt einen erwachsenen männlichen Referenzkörper. Es ist ein Lernhilfsmittel und kein medizinisches Werkzeug.
