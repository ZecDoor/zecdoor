//! View-only arrival check. Trial-decrypts the Orchard and Ironwood actions of compact
//! blocks with the wallet's external and internal incoming viewing keys. Compact blocks
//! carry no branch-specific transaction encoding, so this keeps working across NU7
//! (verified on testnet across activation; research p1-wallet-phantom §A3).

use orchard::keys::{IncomingViewingKey, PreparedIncomingViewingKey, Scope};
use orchard::note_encryption::{CompactAction, IronwoodDomain, OrchardDomain};
use prost::Message;
use serde::Serialize;
use zcash_client_backend::proto::compact_formats::CompactBlock;
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_note_encryption::batch;

use crate::net::Net;

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct Found {
    pub height: u64,
    /// Transaction id in the usual display (big-endian) hex.
    pub txid: String,
    /// `ironwood` or `orchard`.
    pub pool: String,
    /// Zatoshis.
    pub value: u64,
    /// `external` (a receiving address) or `internal` (change).
    pub scope: String,
    /// Diversifier index of the receiving address, when it is below 2^32.
    pub index: Option<u32>,
}

pub struct Scanner {
    prepared: Vec<PreparedIncomingViewingKey>,
    ivks: Vec<IncomingViewingKey>,
    pub blocks: u32,
    pub actions: u32,
}

impl Scanner {
    pub fn new(ufvk: &str, net: Net) -> Result<Scanner, String> {
        let u = UnifiedFullViewingKey::decode(&net, ufvk).map_err(|e| format!("bad viewing key: {e}"))?;
        let fvk = u.orchard().ok_or_else(|| "viewing key has no Orchard part".to_string())?;
        let ivks = vec![fvk.to_ivk(Scope::External), fvk.to_ivk(Scope::Internal)];
        let prepared = ivks.iter().map(PreparedIncomingViewingKey::new).collect();
        Ok(Scanner { prepared, ivks, blocks: 0, actions: 0 })
    }

    pub fn scan_bytes(&mut self, block: &[u8]) -> Result<Vec<Found>, String> {
        let b = CompactBlock::decode(block).map_err(|e| format!("bad compact block: {e}"))?;
        Ok(self.scan(&b))
    }

    pub fn scan(&mut self, b: &CompactBlock) -> Vec<Found> {
        self.blocks += 1;
        let mut out = vec![];
        for tx in &b.vtx {
            self.actions += (tx.actions.len() + tx.ironwood_actions.len()) as u32;
            let txid = {
                let mut t = tx.txid.clone();
                t.reverse();
                hex::encode(t)
            };
            let mut push = |pool: &str, note: orchard::Note, which: usize| {
                let index = self.ivks[which]
                    .diversifier_index(&note.recipient())
                    .and_then(|d| u32::try_from(d).ok());
                out.push(Found {
                    height: b.height,
                    txid: txid.clone(),
                    pool: pool.into(),
                    value: note.value().inner(),
                    scope: if which == 0 { "external" } else { "internal" }.into(),
                    index,
                });
            };
            if !tx.actions.is_empty() {
                let v: Vec<(OrchardDomain, CompactAction)> = tx
                    .actions
                    .iter()
                    .filter_map(|a| CompactAction::try_from(a).ok())
                    .map(|a| (OrchardDomain::for_compact_action(&a), a))
                    .collect();
                for r in batch::try_compact_note_decryption(&self.prepared, &v).into_iter().flatten() {
                    let ((note, _), which) = r;
                    push("orchard", note, which);
                }
            }
            if !tx.ironwood_actions.is_empty() {
                let v: Vec<(IronwoodDomain, CompactAction)> = tx
                    .ironwood_actions
                    .iter()
                    .filter_map(|a| CompactAction::try_from(a).ok())
                    .map(|a| (IronwoodDomain::for_compact_action(&a), a))
                    .collect();
                for r in batch::try_compact_note_decryption(&self.prepared, &v).into_iter().flatten() {
                    let ((note, _), which) = r;
                    push("ironwood", note, which);
                }
            }
        }
        out
    }
}
