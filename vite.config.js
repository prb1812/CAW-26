import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Runs api/pin.js locally during `npm run dev` (Vercel does this in production).
function localPinApi(env) {
  return {
    name: 'local-pin-api',
    configureServer(server) {
      // Make PINATA_JWT / ADMIN_WALLETS from .env.local visible to api/pin.js
      for (const k of ['PINATA_JWT', 'ADMIN_WALLETS']) if (env[k]) process.env[k] = env[k]

      server.middlewares.use('/api/pin', async (req, res) => {
        const send = (code, obj) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(obj))
        }
        res.status = (c) => { res.statusCode = c; return { json: (o) => send(c, o) } }
        try {
          const chunks = []
          for await (const c of req) chunks.push(c)
          try { req.body = JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { req.body = {} }
          const mod = await server.ssrLoadModule('/api/pin.js')
          await mod.default(req, res)
        } catch (e) {
          console.error('[local-pin-api]', e)
          send(500, { error: 'Local pin API crashed: ' + (e?.message || 'unknown') })
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '') // '' = load ALL vars, not just VITE_*
  return {
    plugins: [react(), localPinApi(env)],
    resolve: {
      alias: {
        '@': '/src',
      },
    },
    define: {
      global: 'globalThis',
    },
    optimizeDeps: {
      include: ['ethers', '@tychilabs/react-ugf'],
    },
  }
})