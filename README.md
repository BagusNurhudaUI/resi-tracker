# Resi Tracker

PWA for checking order pickups: match each box's IMEI to the order it was picked for.

1. **Import orders.** Paste one order per line: `invoice | recipient name | product`.
2. **Pickup.** Photograph the invoice, then the box label:
   - The invoice number is read from the invoice barcode (or from the text under it) and matched to an order.
   - The recipient (Penerima), sender (Pengirim) and marketplace are read from the strip just below the barcode. The recipient is compared loosely with the order name: typos, extra or missing names, and masked names (`a***n`) still match.
   - The box label's barcodes give IMEI 1, IMEI 2, serial and EID instantly. The label text is read in the background and gives the product, color and capacity, which are checked against the order's product.
3. **Results.** Orders show as picked or not picked. Boxes that aren't linked to an order show under **Outside orders**. You can link one later with **Scan invoice** or **Pick order**.

Everything stays in the browser on this device (IndexedDB). Use **Export** to get orders with their IMEIs as CSV.

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
