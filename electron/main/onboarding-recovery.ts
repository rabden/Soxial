export class PendingRequestRegistry<T> {
  private readonly pending = new Map<string, (value: T) => void>()

  wait(id: string): Promise<T> {
    return new Promise(resolve => this.pending.set(id, resolve))
  }

  resolve(id: string, value: T): boolean {
    const resolver = this.pending.get(id)
    if (!resolver) return false
    this.pending.delete(id)
    resolver(value)
    return true
  }

  cancelAll(value: T): void {
    for (const [id, resolver] of this.pending) {
      this.pending.delete(id)
      resolver(value)
    }
  }

  get size(): number {
    return this.pending.size
  }
}
