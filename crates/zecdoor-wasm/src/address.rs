//! Destination checks. NEAR Intents 1Click pays a unified address only when it has an
//! Orchard receiver (payments land in the Ironwood pool); it rejects Sapling-only unified
//! addresses and `zs1…` addresses with "recipient is not valid" (research p1-oneclick §A.1).
//! ZecDoor also refuses transparent and TEX addresses: they would land unshielded.

use serde::Serialize;
use zcash_address::{unified, ConversionError, TryFromAddress, ZcashAddress};
use zcash_protocol::consensus::NetworkType;

use crate::net::Net;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Inspection {
    /// `unified`, `sapling`, `transparent`, `tex`, `sprout` or `invalid`.
    pub kind: String,
    /// `main`, `test` or `regtest`; empty when invalid.
    pub network: String,
    /// Receivers in a unified address: `orchard`, `sapling`, `p2pkh`, `p2sh`, `unknown`.
    pub receivers: Vec<String>,
    /// True only for a unified address on the expected network with an Orchard receiver.
    pub ok: bool,
    /// `ok`, `invalid`, `wrong_network`, `no_orchard_receiver`, `sapling_address`,
    /// `transparent_address`, `tex_address` or `sprout_address`.
    pub reason: String,
}

struct Kind {
    kind: &'static str,
    net: NetworkType,
    receivers: Vec<String>,
}

impl TryFromAddress for Kind {
    type Error = ();

    fn try_from_sprout(net: NetworkType, _: [u8; 64]) -> Result<Self, ConversionError<()>> {
        Ok(Kind { kind: "sprout", net, receivers: vec![] })
    }
    fn try_from_sapling(net: NetworkType, _: [u8; 43]) -> Result<Self, ConversionError<()>> {
        Ok(Kind { kind: "sapling", net, receivers: vec![] })
    }
    fn try_from_unified(net: NetworkType, ua: unified::Address) -> Result<Self, ConversionError<()>> {
        use zcash_address::unified::{Container, Receiver};
        let receivers = ua
            .items()
            .iter()
            .map(|r| {
                match r {
                    Receiver::Orchard(_) => "orchard",
                    Receiver::Sapling(_) => "sapling",
                    Receiver::P2pkh(_) => "p2pkh",
                    Receiver::P2sh(_) => "p2sh",
                    Receiver::Unknown { .. } => "unknown",
                }
                .to_string()
            })
            .collect();
        Ok(Kind { kind: "unified", net, receivers })
    }
    fn try_from_transparent_p2pkh(net: NetworkType, _: [u8; 20]) -> Result<Self, ConversionError<()>> {
        Ok(Kind { kind: "transparent", net, receivers: vec![] })
    }
    fn try_from_transparent_p2sh(net: NetworkType, _: [u8; 20]) -> Result<Self, ConversionError<()>> {
        Ok(Kind { kind: "transparent", net, receivers: vec![] })
    }
    fn try_from_tex(net: NetworkType, _: [u8; 20]) -> Result<Self, ConversionError<()>> {
        Ok(Kind { kind: "tex", net, receivers: vec![] })
    }
}

pub fn inspect(addr: &str, expected: Net) -> Inspection {
    let parsed = ZcashAddress::try_from_encoded(addr.trim())
        .ok()
        .and_then(|a| a.convert::<Kind>().ok());
    let Some(k) = parsed else {
        return Inspection {
            kind: "invalid".into(),
            network: String::new(),
            receivers: vec![],
            ok: false,
            reason: "invalid".into(),
        };
    };
    let network = Net::from_type(k.net);
    let reason = if network != expected {
        "wrong_network"
    } else {
        match k.kind {
            "unified" if k.receivers.iter().any(|r| r == "orchard") => "ok",
            "unified" => "no_orchard_receiver",
            "sapling" => "sapling_address",
            "transparent" => "transparent_address",
            "tex" => "tex_address",
            _ => "sprout_address",
        }
    };
    Inspection {
        kind: k.kind.into(),
        network: network.name().into(),
        receivers: k.receivers,
        ok: reason == "ok",
        reason: reason.into(),
    }
}
