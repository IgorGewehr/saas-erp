#!/bin/bash
set -e

CSS_DIR=".next/static/css"

# 1. Generate CSS
mkdir -p "$CSS_DIR"
npx tailwindcss -i app/globals.css -o "$CSS_DIR/generated-tailwind.css" --minify 2>/dev/null
cp node_modules/react-toastify/dist/ReactToastify.css "$CSS_DIR/generated-toastify.css"
echo "[css-fix] Generated Tailwind + Toastify CSS"

# 2. Create CSS chunk stubs + patch HTML (all done in node)
node /tmp/find-missing-css-chunks.js
