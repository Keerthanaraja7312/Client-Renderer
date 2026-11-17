# Skiode client viewer

Renders pages published from the View Builder (`/p/<slug>`).

    npm install
    npm run dev        # http://localhost:5174

Edit `.env` if your backend is not at http://127.0.0.1:8000.
Open a published page at http://localhost:5174/p/<slug> (the slug you typed in the builder's Publish dialog).

Production: `npm run build` -> serve the `dist/` folder (SPA: route all paths to index.html).
