Deploying this Vite + React app to Vercel

Steps:

1. Ensure `package.json` has a `build` script (this project uses `vite build`).
2. From the `new-ada-accm` folder run:

```bash
npm install
npm run build
```

3. In the Vercel dashboard, import the repository and set the root directory to `new-ada-accm` (or deploy from this folder). Vercel will run `npm run build` and publish the `dist` folder.

Alternatively, use the Vercel CLI:

```bash
npm i -g vercel
cd new-ada-accm
vercel --prod
```

The provided `vercel.json` uses `@vercel/static-build` and expects the build output in `dist`.
<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1YY1LW-zWzxDBePdL_KwlpWoI008ZP-qf

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
