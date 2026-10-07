//! Whether an address belongs to a viewing key: the check behind "your restored wallet is the same
//! wallet". A wallet app such as Zodl shows unified addresses with Orchard, Sapling and transparent
//! receivers at an index of its own choosing; the Orchard receiver alone tells whether the address
//! was derived from this key, and at which index (Orchard's diversifier index is recoverable with the
//! key, and checked by re-deriving the address).

use orchard::keys::Scope;
use serde::Serialize;
use zcash_address::{unified, ConversionError, TryFromAddress, ZcashAddress};
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_protocol::consensus::NetworkType;

use crate::net::Net;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Ownership {
    /// True when the address's Orchard receiver was derived from the key.
    pub belongs: bool,
    /// `external` (a receiving address) or `internal` (change); empty when it does not belong.
    pub scope: String,
    /// Diversifier index, when it belongs and fits in 53 bits (JavaScript's safe integers).
    pub index: Option<u64>,
    /// `ok`, `not_this_wallet`, `no_orchard_receiver`, `wrong_network` or `invalid`.
    pub reason: String,
}

struct Orchard {
    net: NetworkType,
    receiver: Option<[u8; 43]>,
}

impl TryFromAddress for Orchard {
    type Error = ();

    fn try_from_unified(net: NetworkType, ua: unified::Address) -> Result<Self, ConversionError<()>> {
        use zcash_address::unified::{Container, Receiver};
        let receiver = ua.items().iter().find_map(|r| match r {
            Receiver::Orchard(b) => Some(*b),
            _ => None,
        });
        Ok(Orchard { net, receiver })
    }
    fn try_from_sprout(net: NetworkType, _: [u8; 64]) -> Result<Self, ConversionError<()>> {
        Ok(Orchard { net, receiver: None })
    }
    fn try_from_sapling(net: NetworkType, _: [u8; 43]) -> Result<Self, ConversionError<()>> {
        Ok(Orchard { net, receiver: None })
    }
    fn try_from_transparent_p2pkh(net: NetworkType, _: [u8; 20]) -> Result<Self, ConversionError<()>> {
        Ok(Orchard { net, receiver: None })
    }
    fn try_from_transparent_p2sh(net: NetworkType, _: [u8; 20]) -> Result<Self, ConversionError<()>> {
        Ok(Orchard { net, receiver: None })
    }
    fn try_from_tex(net: NetworkType, _: [u8; 20]) -> Result<Self, ConversionError<()>> {
        Ok(Orchard { net, receiver: None })
    }
}

fn result(reason: &str) -> Ownership {
    Ownership { belongs: false, scope: String::new(), index: None, reason: reason.into() }
}

pub fn owner(ufvk: &str, net: Net, addr: &str) -> Result<Ownership, String> {
    let u = UnifiedFullViewingKey::decode(&net, ufvk).map_err(|e| format!("bad viewing key: {e}"))?;
    let fvk = u.orchard().ok_or_else(|| "the viewing key has no Orchard part".to_string())?;
    let Some(parsed) = ZcashAddress::try_from_encoded(addr.trim()).ok().and_then(|a| a.convert::<Orchard>().ok()) else {
        return Ok(result("invalid"));
    };
    if Net::from_type(parsed.net) != net {
        return Ok(result("wrong_network"));
    }
    let Some(bytes) = parsed.receiver else {
        return Ok(result("no_orchard_receiver"));
    };
    let Some(address) = Option::<orchard::Address>::from(orchard::Address::from_raw_address_bytes(&bytes)) else {
        return Ok(result("invalid"));
    };
    for (scope, name) in [(Scope::External, "external"), (Scope::Internal, "internal")] {
        if let Some(j) = fvk.to_ivk(scope).diversifier_index(&address) {
            let index = u64::try_from(u128::from(j)).ok().filter(|i| *i < (1u64 << 53));
            return Ok(Ownership { belongs: true, scope: name.into(), index, reason: "ok".into() });
        }
    }
    Ok(result("not_this_wallet"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::{address_at, new_mnemonic, ufvk_from_mnemonic};
    use zcash_address::unified::{Encoding, Receiver};

    fn wallet() -> String {
        ufvk_from_mnemonic(&new_mnemonic().unwrap(), Net::Main).unwrap()
    }

    /// The Orchard receiver of one of our Orchard-only addresses.
    fn orchard_bytes(addr: &str) -> [u8; 43] {
        ZcashAddress::try_from_encoded(addr).unwrap().convert::<Orchard>().unwrap().receiver.unwrap()
    }

    #[test]
    fn finds_our_own_addresses_and_their_index() {
        let u = wallet();
        for i in [0u32, 1, 7, 4242] {
            let a = address_at(&u, Net::Main, i).unwrap();
            let o = owner(&u, Net::Main, &a).unwrap();
            assert_eq!(o, Ownership { belongs: true, scope: "external".into(), index: Some(i as u64), reason: "ok".into() });
        }
    }

    #[test]
    fn a_wallet_app_style_address_with_more_receivers_still_matches() {
        // Zodl shows unified addresses with Sapling (and transparent) receivers next to Orchard.
        let u = wallet();
        let orchard = orchard_bytes(&address_at(&u, Net::Main, 3).unwrap());
        let ua = unified::Address::try_from_items(vec![Receiver::Orchard(orchard), Receiver::Sapling([7u8; 43]), Receiver::P2pkh([9u8; 20])]).unwrap();
        let encoded = ua.encode(&NetworkType::Main);
        let o = owner(&u, Net::Main, &encoded).unwrap();
        assert!(o.belongs);
        assert_eq!(o.index, Some(3));
    }

    #[test]
    fn another_wallet_or_a_non_orchard_address_does_not_match() {
        let u = wallet();
        let other = address_at(&wallet(), Net::Main, 0).unwrap();
        assert_eq!(owner(&u, Net::Main, &other).unwrap().reason, "not_this_wallet");
        assert_eq!(owner(&u, Net::Main, "t1J5WT7CwfJy7WJaMkYweYT2JUnSebbVRz4").unwrap().reason, "no_orchard_receiver");
        assert_eq!(owner(&u, Net::Main, "nonsense").unwrap().reason, "invalid");
        let testnet = address_at(&ufvk_from_mnemonic(&new_mnemonic().unwrap(), Net::Test).unwrap(), Net::Test, 0).unwrap();
        assert_eq!(owner(&u, Net::Main, &testnet).unwrap().reason, "wrong_network");
    }
}
