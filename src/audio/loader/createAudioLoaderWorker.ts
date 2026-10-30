/**
 * Default AudioLoader worker.
 *
 * `new URL(..., import.meta.url)` is the bundler-neutral form Vite (app and
 * library builds) and webpack 5 both turn into a separate worker chunk, so
 * consumers that compile this package from source get a working loader
 * without wiring a `?worker` import themselves.
 */
export function createAudioLoaderWorker(): Worker {
    return new Worker(new URL('./AudioLoader.worker.ts', import.meta.url), { type: 'module' });
}
