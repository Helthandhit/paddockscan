{
  "hosting": {
    "public": ".",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**", "README.md", "FIREBASE_SETUP.md", "firestore.rules", "storage.rules"],
    "rewrites": [{"source":"**","destination":"/index.html"}],
    "headers": [
      {"source":"**/*.@(js|css)","headers":[{"key":"Cache-Control","value":"public,max-age=3600"}]},
      {"source":"**/*.@(png|svg|webp|jpg|jpeg)","headers":[{"key":"Cache-Control","value":"public,max-age=604800"}]}
    ]
  },
  "firestore": {"rules":"firestore.rules"},
  "storage": {"rules":"storage.rules"}
}
