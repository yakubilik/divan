# The office page

`pixtuoid_web.js` and `pixtuoid_web_bg.wasm` are pixtuoid's web crate
(github.com/pixtuoid/pixtuoid, MIT, see PIXTUOID-LICENSE), built at
8929791f with `pixtuoid-live.patch` applied: an `Office.live(seed)`
that shows only the hook lines it is sent and leaves the words to the page.
The pixel font is Fusion Pixel 8px (OFL, see OFL-Fusion-Pixel.txt).

To rebuild:

    git clone https://github.com/pixtuoid/pixtuoid && cd pixtuoid
    git apply /path/to/pixtuoid-live.patch
    rustup target add wasm32-unknown-unknown
    cargo install wasm-bindgen-cli --version <Cargo.lock's wasm-bindgen> --locked
    cargo build -p pixtuoid-web --target wasm32-unknown-unknown --profile wasm-release
    wasm-bindgen --target web --out-dir out target/wasm32-unknown-unknown/wasm-release/pixtuoid_web.wasm

and copy the two files from `out/` here.
