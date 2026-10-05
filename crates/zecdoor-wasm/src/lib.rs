//! ZecDoor's browser-side Zcash code.
//!
//! It never builds, signs or sends a Zcash transaction. It only:
//! - makes a 24-word seed (BIP 39, standard ZIP 32 keys, `use_qsk = false`),
//! - derives an Orchard-only viewing key and fresh Orchard-only addresses,
//! - checks whether a pasted Zcash address can receive a shielded payment,
//! - finds incoming Orchard and Ironwood notes in compact blocks with the viewing key.
//!
//! The seed and the spending key exist only inside `ufvk_from_mnemonic` and are wiped
//! before it returns. Nothing here talks to the network.

pub mod address;
pub mod keys;
pub mod net;
pub mod scan;

use wasm_bindgen::prelude::*;

fn js_err(e: impl core::fmt::Display) -> JsValue {
    JsValue::from_str(&e.to_string())
}

/// A new 24-word English BIP 39 phrase from 32 bytes of OS randomness.
#[wasm_bindgen]
pub fn new_mnemonic() -> Result<String, JsValue> {
    keys::new_mnemonic().map_err(js_err)
}

/// True when `phrase` is a valid 24-word English BIP 39 phrase.
#[wasm_bindgen]
pub fn is_valid_mnemonic(phrase: &str) -> bool {
    keys::is_valid_mnemonic(phrase)
}

/// The Orchard-only unified full viewing key (`uview1…`) for account 0 of `phrase`.
/// `network` is `"main"`, `"test"` or `"regtest"`.
#[wasm_bindgen]
pub fn ufvk_from_mnemonic(phrase: &str, network: &str) -> Result<String, JsValue> {
    let n = net::Net::parse(network).map_err(js_err)?;
    keys::ufvk_from_mnemonic(phrase, n).map_err(js_err)
}

/// The Orchard-only unified address at diversifier `index` (external scope).
#[wasm_bindgen]
pub fn address_at(ufvk: &str, network: &str, index: u32) -> Result<String, JsValue> {
    let n = net::Net::parse(network).map_err(js_err)?;
    keys::address_at(ufvk, n, index).map_err(js_err)
}

/// JSON describing whether `addr` can be a ZecDoor destination on `network`.
/// See [`address::Inspection`].
#[wasm_bindgen]
pub fn inspect_address(addr: &str, network: &str) -> Result<String, JsValue> {
    let n = net::Net::parse(network).map_err(js_err)?;
    serde_json::to_string(&address::inspect(addr, n)).map_err(js_err)
}

/// Finds notes paid to a viewing key in serialized `CompactBlock`s.
#[wasm_bindgen]
pub struct Scanner {
    inner: scan::Scanner,
}

#[wasm_bindgen]
impl Scanner {
    #[wasm_bindgen(constructor)]
    pub fn new(ufvk: &str, network: &str) -> Result<Scanner, JsValue> {
        let n = net::Net::parse(network).map_err(js_err)?;
        Ok(Scanner { inner: scan::Scanner::new(ufvk, n).map_err(js_err)? })
    }

    /// Scans one serialized `CompactBlock` and returns the notes found, as a JSON array
    /// of [`scan::Found`].
    pub fn scan(&mut self, block: &[u8]) -> Result<String, JsValue> {
        let found = self.inner.scan_bytes(block).map_err(js_err)?;
        serde_json::to_string(&found).map_err(js_err)
    }

    #[wasm_bindgen(getter)]
    pub fn blocks(&self) -> u32 {
        self.inner.blocks
    }

    #[wasm_bindgen(getter)]
    pub fn actions(&self) -> u32 {
        self.inner.actions
    }
}
