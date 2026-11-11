/** Deterministic test double; NOT a cryptographic digest. Never import in app. */
export function fakeWebCrypto() {
  return {
    randomUUID: () => '2a0b0c0d-0e0f-4a11-8a22-333344445555',
    subtle: {
      digest: async (_algorithm: string, value: BufferSource) => {
        const data = new Uint8Array(value as ArrayBuffer)
        const result = new Uint8Array(32)
        data.forEach((byte, index) => {
          result[index % 32] = (result[index % 32] + byte + index) % 256
        })
        return result.buffer
      },
    },
  }
}
