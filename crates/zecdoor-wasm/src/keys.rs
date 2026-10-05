use bip0039::{Count, English, Mnemonic};
use zcash_keys::keys::{UnifiedAddressRequest, UnifiedFullViewingKey, UnifiedSpendingKey};
use zeroize::Zeroize;
use zip32::{AccountId, DiversifierIndex};

use crate::net::Net;

/// A new 24-word phrase (256 bits of entropy).
pub fn new_mnemonic() -> Result<String, String> {
    let mut entropy = [0u8; 32];
    getrandom::fill(&mut entropy).map_err(|e| format!("no randomness: {e}"))?;
    let m = Mnemonic::<English>::from_entropy(entropy.to_vec()).map_err(|e| format!("{e:?}"));
    entropy.zeroize();
    Ok(m?.phrase().to_string())
}

/// Zodl accepts exactly 24 words, so that is all we accept too.
pub fn is_valid_mnemonic(phrase: &str) -> bool {
    match Mnemonic::<English>::from_phrase(normalize(phrase)) {
        Ok(m) => m.phrase().split(' ').count() == Count::Words24.word_count(),
        Err(_) => false,
    }
}

fn normalize(phrase: &str) -> String {
    phrase.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// Orchard-only UFVK for an account, from raw seed bytes. The crate enables only the
/// `orchard` feature of `zcash_keys`, so the derived UFVK has no Sapling or transparent
/// part; the check below keeps it that way if features ever change.
pub fn ufvk_from_seed(seed: &[u8], net: Net, account: u32) -> Result<UnifiedFullViewingKey, String> {
    let account = AccountId::try_from(account).map_err(|_| "bad account index".to_string())?;
    let usk = UnifiedSpendingKey::from_seed(&net, seed, account).map_err(|e| format!("{e:?}"))?;
    let ufvk = usk.to_unified_full_viewing_key();
    if ufvk.orchard().is_none() {
        return Err("no Orchard key".into());
    }
    Ok(ufvk)
}

/// Orchard-only UFVK (encoded) for account 0 of a 24-word phrase. The seed is wiped
/// before returning.
pub fn ufvk_from_mnemonic(phrase: &str, net: Net) -> Result<String, String> {
    if !is_valid_mnemonic(phrase) {
        return Err("not a valid 24-word phrase".into());
    }
    let m = Mnemonic::<English>::from_phrase(normalize(phrase)).map_err(|e| format!("{e:?}"))?;
    let mut seed = m.to_seed("");
    let ufvk = ufvk_from_seed(&seed, net, 0);
    seed.zeroize();
    Ok(ufvk?.encode(&net))
}

/// Orchard-only unified address at diversifier `index`, external scope.
pub fn address_at(ufvk: &str, net: Net, index: u32) -> Result<String, String> {
    let u = UnifiedFullViewingKey::decode(&net, ufvk).map_err(|e| format!("bad viewing key: {e}"))?;
    let ua = u
        .address(DiversifierIndex::from(index), UnifiedAddressRequest::ORCHARD)
        .map_err(|e| format!("{e:?}"))?;
    Ok(ua.encode(&net))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_mnemonic_is_24_valid_words() {
        let p = new_mnemonic().unwrap();
        assert_eq!(p.split(' ').count(), 24);
        assert!(is_valid_mnemonic(&p));
        assert_ne!(p, new_mnemonic().unwrap());
    }

    #[test]
    fn rejects_short_or_bad_phrases() {
        assert!(!is_valid_mnemonic("abandon abandon abandon"));
        // 12-word valid BIP 39 phrase: refused, Zodl needs 24.
        assert!(!is_valid_mnemonic(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
        ));
        let mut p = new_mnemonic().unwrap();
        p.push_str(" zoo");
        assert!(!is_valid_mnemonic(&p));
    }

    #[test]
    fn same_phrase_same_keys_and_whitespace_is_tolerated() {
        let p = new_mnemonic().unwrap();
        let a = ufvk_from_mnemonic(&p, Net::Main).unwrap();
        let messy = format!("  {}  ", p.to_uppercase().replace(' ', "   "));
        assert_eq!(a, ufvk_from_mnemonic(&messy, Net::Main).unwrap());
        assert!(a.starts_with("uview1"));
    }

    #[test]
    fn fresh_addresses_differ_and_are_orchard_only() {
        let u = ufvk_from_mnemonic(&new_mnemonic().unwrap(), Net::Main).unwrap();
        let a0 = address_at(&u, Net::Main, 0).unwrap();
        let a1 = address_at(&u, Net::Main, 1).unwrap();
        assert_ne!(a0, a1);
        for a in [&a0, &a1] {
            let i = crate::address::inspect(a, Net::Main);
            assert!(i.ok, "{i:?}");
            assert_eq!(i.receivers, vec!["orchard".to_string()]);
        }
    }
}
