// @ts-check
import fs from "fs"
import express from "express"
import { WebSocketServer } from "ws"
import { Repo } from "@automerge/automerge-repo"
import { NodeWSServerAdapter } from "@automerge/automerge-repo-network-websocket"
import { NodeFSStorageAdapter } from "@automerge/automerge-repo-storage-nodefs"
import storage from 'node-persist'
import os from "os"

import cors from "cors"
import bs58 from 'bs58' // experimental - only used to verify Automerge handles

await storage.init()

export class Server {
  /** @type WebSocketServer */
  #socket

  /** @type ReturnType<import("express").Express["listen"]> */
  #server

  /** @type {((value: any) => void)[]} */
  #readyResolvers = []

  #isReady = false

  /** @type Repo */
  #repo

  constructor() {
    const dir =
      process.env.DATA_DIR !== undefined ? process.env.DATA_DIR : ".amrg"
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir)
    }

    var hostname = os.hostname()

    this.#socket = new WebSocketServer({ noServer: true })

    const PORT =
      process.env.PORT !== undefined ? parseInt(process.env.PORT) : 3030
    const app = express()

    // app.use(express.static("public"))

    // combine with cors middleware? https://stackoverflow.com/a/70233116
    /** @ts-ignore @type {(import("cors").CorsOptions)}  */
    let corsOptions = {
      /** @ts-ignore @type {( requestOrigin: string | undefined,
          callback: (err: Error | null, origin?: boolean | string | RegExp) => void,
      ) => void
      }  */
      origin: function (origin, callback) {
        let whitelist = ["http://localhost:8080", "https://bitsy.mixedinitiatives.net", "https://jazztap.github.io/bitsy"]
        if (!origin || whitelist.indexOf(origin) !== -1) {
          callback(null, true)
        } else {
          callback(new Error('Not allowed by CORS'))
        }
      }
    }
    app.use(cors(corsOptions))

    const config = {
      network: [new NodeWSServerAdapter(this.#socket)],
      storage: new NodeFSStorageAdapter(dir),
      /** @ts-ignore @type {(import("@automerge/automerge-repo").PeerId)}  */
      peerId: `storage-server-${hostname}`,
      // Since this is a server, we don't share generously — meaning we only sync documents they already
      // know about and can ask for by ID.
      sharePolicy: async () => false,
    }
    this.#repo = new Repo(config)

    app.get("/", (req, res) => {
      res.send(`👍 @automerge/automerge-repo-sync-server is running`)
    })

    app.post('/api/handle', express.json({limit: 500}), async (req, res) => {
      const {iid} = req.body
      if (!iid || typeof iid !== 'string') {
        return res.status(400).json({ 
          error: 'Please provide a valid string in the iid field'
        });
      }
      res.json({ 
        result: (await storage.getItem(iid)) || false
      });
    });

    app.post('/api/assign', express.json({limit: 1500}), async (req, res) => {
      const {iid, handle} = req.body

      try {
        if (!iid || typeof iid !== 'string' || !handle || !bs58.decode(handle)) {
          return res.status(400).json({ 
            error: 'Please provide a string _iid_, and an Automerge document _handle_' 
          });
        }
        await storage.setItem(iid, handle)
        res.json({
          result: true
        })
      }
      catch {
        return res.status(400).json({ 
          error: "oops, couldn't stash that handle" 
        });
      }
    })

    this.#server = app.listen(PORT, () => {
      console.log(`Listening on port ${PORT}`)
      this.#isReady = true
      this.#readyResolvers.forEach((resolve) => resolve(true))
    })

    this.#server.on("upgrade", (request, socket, head) => {
      this.#socket.handleUpgrade(request, socket, head, (socket) => {
        this.#socket.emit("connection", socket, request)
      })
    })
  }

  async ready() {
    if (this.#isReady) {
      return true
    }

    return new Promise((resolve) => {
      this.#readyResolvers.push(resolve)
    })
  }

  close() {
    this.#socket.close()
    this.#server.close()
  }
}
