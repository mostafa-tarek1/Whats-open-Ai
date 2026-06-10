# cPanel Deployment

This project is a NestJS Node API plus a Vite dashboard. It needs a cPanel plan that supports Node.js applications and long-running processes. Plain shared hosting that only serves PHP/static files is not enough for the API.

## Recommended Layout

- API: `api.example.com` as a cPanel Node.js application.
- Dashboard: `example.com` or `dashboard.example.com` as static files from `dashboard/dist`.
- Database: SQLite for the simplest cPanel setup.
- Redis/queue: disabled unless your hosting provider gives you Redis.

## API Deployment

1. Create a Node.js app in cPanel.
2. Choose Node.js 20 or newer if available.
3. Set the application root to the uploaded project directory.
4. Set the startup file to:

   ```text
   dist/main.js
   ```

5. In cPanel Terminal, inside the project directory, install and build:

   ```bash
   npm ci
   npm run build
   ```

6. Add production environment variables in cPanel's Node.js app screen:

   ```env
   NODE_ENV=production
   DATABASE_TYPE=sqlite
   DATABASE_NAME=./data/openwa.sqlite
   DATABASE_SYNCHRONIZE=true
   SESSION_DATA_PATH=./data/sessions
   STORAGE_TYPE=local
   STORAGE_LOCAL_PATH=./data/media
   REDIS_ENABLED=false
   QUEUE_ENABLED=false
   PUPPETEER_HEADLESS=true
   PUPPETEER_SKIP_DOWNLOAD=true
   PUPPETEER_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-gpu
   CORS_ORIGINS=https://example.com
   ```

   Do not set `PORT` manually unless your host asks you to. cPanel usually injects it.
   If your host provides Chrome/Chromium, also set `PUPPETEER_EXECUTABLE_PATH`, for example `/usr/bin/chromium-browser` or `/usr/bin/google-chrome`.

7. Restart the Node.js app from cPanel.
8. Test:

   ```text
   https://api.example.com/api/health
   https://api.example.com/api/docs
   ```

## Dashboard Deployment

Build the dashboard with the public API URL:

```bash
cd dashboard
npm ci
VITE_API_BASE_URL=https://api.example.com/api npm run build
```

Upload the contents of `dashboard/dist` to the dashboard domain's document root, for example `public_html`.

The `.htaccess` file is copied into `dashboard/dist` during build, so dashboard routes should keep working after refresh.

## Important Hosting Notes

`whatsapp-web.js` uses Chromium/Puppeteer. Some shared cPanel hosts block the required browser dependencies or background processes. If sessions fail to start or QR generation fails, ask your hosting provider whether Chromium/Puppeteer is supported on Node.js apps. If not, deploy this project on a VPS with cPanel/WHM, Docker, or a Node-friendly host.

Keep the `data` directory persistent. It stores SQLite databases, media, and WhatsApp sessions.
