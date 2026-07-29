# Numera v0.1 — Homework that teaches

A mobile-first Cloudflare Pages prototype for converting photographed Year 4 maths worksheets into interactive homework.

## What works

- Teacher uploads several worksheet images
- OpenAI Vision extracts draft questions
- Teacher reviews and edits questions
- Unique homework link is generated
- Student enters their name and completes the quiz
- First-attempt and mastery scores are stored separately
- Wrong answers trigger a hint, explanation, retry and follow-up practice
- Parent completion summary
- Teacher results dashboard
- Demo mode works without an OpenAI API key

## Prototype limitations

- Number-entry and multiple-choice questions are fully interactive
- Other worksheet questions are converted to number or multiple-choice wherever possible
- Geometry construction, drag-and-drop, graph-point selection and automatic marking of handwritten working are deferred
- There is no authentication yet
- Anyone with a teacher link can view that homework's results
- Do not use real pupil data beyond a small private family prototype

## Deploy using Cloudflare Pages

### 1. Put the project on GitHub

Create a new GitHub repository named `numera`, then upload all files in this folder.

### 2. Create the D1 database

In Cloudflare:

1. Go to **Storage & Databases → D1**
2. Create a database named `numera`
3. Copy its database ID
4. Replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` in `wrangler.toml`

### 3. Create the Pages project

1. Go to **Workers & Pages**
2. Select **Create → Pages → Connect to Git**
3. Select the Numera repository
4. Framework preset: **None**
5. Build command: leave blank
6. Build output directory: `public`

### 4. Bind D1

In the Pages project:

1. **Settings → Bindings**
2. Add a **D1 database binding**
3. Variable name: `DB`
4. Database: `numera`
5. Save

Cloudflare Pages Functions access D1 through an environment binding. The code expects the binding to be named `DB`.

### 5. Create the tables

Open the D1 database in Cloudflare, select **Console**, paste the contents of `schema.sql`, and run it.

### 6. Add the OpenAI secret

In the Pages project:

1. **Settings → Variables and Secrets**
2. Add encrypted secret:
   - Name: `OPENAI_API_KEY`
   - Value: your OpenAI API key
3. Optional plain-text variable:
   - Name: `OPENAI_MODEL`
   - Value: a vision-capable model available to your account
4. Save and redeploy

The key remains server-side in the Pages Function and is never exposed to the browser.

### 7. Redeploy

Open **Deployments**, choose the newest deployment, and select **Retry deployment**.

## First test

1. Open the deployed URL
2. Select **Create homework**
3. Upload one or more clear worksheet photos
4. Review the extracted questions
5. Publish
6. Open the student link in another browser tab
7. Complete it as Aaryan
8. Return to the teacher results link

## Demo mode

If no OpenAI key has been configured, the extraction endpoint returns a polished Year 4 demo quiz. This lets you test the entire workflow before configuring AI.
