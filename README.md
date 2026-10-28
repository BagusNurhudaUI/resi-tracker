# Resi Tracker

PWA for scanning product box labels. Take a photo and the app:

1. Decodes every barcode in the photo (zxing-wasm, bundled locally) and saves the record to IndexedDB right away.
2. Reads all the text on the label in the background (tesseract.js) and fills in what barcodes missed: product, color, capacity, part no., model, IMEI 2, EID.

Everything stays in the browser on this device. Use **Export CSV** to get the data out.

## Develop

```sh
npm install
npm run dev
```

The dev server runs on HTTPS with a self-signed certificate and listens on your LAN, so you can open
`https://<your-pc-ip>:5173` on a phone (accept the certificate warning) to test the camera.

## Deploy

Push to a Git repo and import it in Vercel. `vercel.json` sets the build and the caching headers for the
service worker. `.npmrc` sets `legacy-peer-deps` because the template's `typescript-eslint` doesn't accept TypeScript 7 yet.

## Notes

- The first OCR run downloads the tesseract engine and English data (a few MB) from jsDelivr. After that they're cached, and the app works offline.
- If barcodes are missed, take the photo closer and tilt the box to get rid of glare from the shrink-wrap.
