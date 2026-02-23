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
            },
            {
                entry: 'electron/preload.js',
                onstart(options) {
                    options.reload()
                },
                vite: {
                    build: {
                        rollupOptions: {
                            output: {
                                entryFileNames: '[name].cjs',
                                format: 'cjs', // VERY IMPORTANT: Preload MUST be CommonJS
                            }
                        }
                    }
                }
            }
        ]),
        renderer(),
    ],
})
