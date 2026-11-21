import express from 'express'
import { fileURLToPath } from 'node:url'
import { roomFunction } from './rooms.js'

const app = express()
const port = Number(process.env.PORT || 3000)
const host = process.env.LISTEN_HOST || '127.0.0.1'
const dist = fileURLToPath(new URL('../../client/dist/', import.meta.url))

app.disable('x-powered-by')
app.all('/api/room', async (req, res) => {
  const headers = new Headers()
  for (const name of ['authorization', 'content-type']) {
    const value = req.get(name)
    if (value) headers.set(name, value)
  }
  const request = new Request(new URL(req.originalUrl, 'http://localhost'), { method: req.method, headers })
  const response = await roomFunction.fetch(request)
  response.headers.forEach((value, name) => res.setHeader(name, value))
  res.status(response.status).send(await response.text())
})

app.use(express.static(dist))
app.get('/s/:id', (_req, res) => res.sendFile('index.html', { root: dist }))

app.listen(port, host, () => console.log(`ScreenShare disponível em http://${host}:${port}`))
