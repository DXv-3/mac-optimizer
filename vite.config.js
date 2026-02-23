import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        electron([
            {
                entry: 'electron/main.js',
                vite: {
                    build: {
                        rollupOptions: {
                            output: {
                                format: 'es',
                            }
                        }
                    }
                }
            }
            // NOTE: preload.cjs is NOT compiled by Vite. 
            // It is a raw CommonJS file loaded directly by Electron.
            // Vite's Rollup bundler was injecting ESM 'export default' syntax 
            // into the compiled .cjs output, which Electron's preload loader rejects.
        ]),
        renderer(),
    ],
})
