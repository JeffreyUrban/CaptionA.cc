/**
 * Server-Sent Events (SSE) Broadcaster
 *
 * Manages SSE connections and broadcasts events to all connected clients.
 * Used for real-time video stats updates when Prefect flows complete.
 */

import { EventEmitter } from 'events'

interface SSEClient {
  id: string
  controller: ReadableStreamDefaultController
  send: (data: string) => void
  close: () => void
}

class SSEBroadcaster extends EventEmitter {
  private clients: Map<string, SSEClient> = new Map()
  private nextClientId = 1

  /**
   * Register a new SSE client connection
   */
  addClient(controller: ReadableStreamDefaultController): SSEClient {
    const id = `client-${this.nextClientId++}`

    const client: SSEClient = {
      id,
      controller,
      send: (data: string) => {
        try {
          controller.enqueue(new TextEncoder().encode(data))
        } catch (error) {
          console.error(`[SSE] Failed to send to ${id}:`, error)
          this.removeClient(id)
        }
      },
      close: () => {
        this.removeClient(id)
      },
    }

    this.clients.set(id, client)
    console.log(`[SSE] Client connected: ${id} (total: ${this.clients.size})`)

    // Send initial connection message
    client.send(': connected\n\n')

    return client
  }

  /**
   * Remove a client connection
   */
  removeClient(clientId: string) {
    if (this.clients.delete(clientId)) {
      console.log(`[SSE] Client disconnected: ${clientId} (total: ${this.clients.size})`)
    }
  }

  /**
   * Broadcast an event to all connected clients
   */
  broadcast(event: string, data: unknown) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    console.log(`[SSE] Broadcasting to ${this.clients.size} clients: ${event}`, data)

    for (const client of this.clients.values()) {
      client.send(message)
    }
  }

  /**
   * Get current connection count
   */
  getClientCount(): number {
    return this.clients.size
  }
}

// Singleton instance
export const sseBroadcaster = new SSEBroadcaster()
