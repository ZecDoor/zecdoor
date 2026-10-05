//! Checks against the official ZIP 316 unified-address test vectors
//! (tests/vectors/unified_address.json, from
//! https://github.com/zcash/zcash-test-vectors/blob/master/test-vectors/json/unified_address.json).

use zcash_address::unified::{self, Encoding, Receiver};
use zcash_address::{ToAddress, ZcashAddress};
use zcash_keys::keys::UnifiedAddressRequest;
use zcash_protocol::consensus::NetworkType;
use zecdoor_wasm::address::inspect;
use zecdoor_wasm::keys::ufvk_from_seed;
use zecdoor_wasm::net::Net;
use zip32::DiversifierIndex;

struct Vector {
    p2pkh: Option<[u8; 20]>,
    sapling: Option<[u8; 43]>,
    orchard: Option<[u8; 43]>,
    ua: String,
    seed: Vec<u8>,
    account: u32,
    index: u128,
}

fn arr<const N: usize>(v: &serde_json::Value) -> Option<[u8; N]> {
    v.as_str().map(|s| hex::decode(s).unwrap().try_into().unwrap())
}

fn vectors() -> Vec<Vector> {
    let raw: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("vectors/unified_address.json")).unwrap();
    // First two rows are the source and the column names.
    raw[2..]
        .iter()
        .map(|r| Vector {
            p2pkh: arr::<20>(&r[0]),
            sapling: arr::<43>(&r[2]),
            orchard: arr::<43>(&r[3]),
            ua: r[6].as_str().unwrap().to_string(),
            seed: hex::decode(r[7].as_str().unwrap()).unwrap(),
            account: r[8].as_u64().unwrap() as u32,
            index: r[9].as_u64().map(u128::from).unwrap_or_else(|| r[9].as_str().unwrap().parse().unwrap()),
        })
        .collect()
}

#[test]
fn derived_orchard_receivers_match_zip316_vectors() {
    let mut checked = 0;
    for v in vectors() {
        let Some(expected) = v.orchard else { continue };
        let ufvk = ufvk_from_seed(&v.seed, Net::Main, v.account).unwrap();
        let di = DiversifierIndex::try_from(v.index).unwrap();
        let ua = ufvk.address(di, UnifiedAddressRequest::ORCHARD).unwrap();
        assert_eq!(ua.orchard().unwrap().to_raw_address_bytes(), expected, "vector {}", v.ua);
        checked += 1;
    }
    assert!(checked >= 20, "only {checked} vectors had an Orchard receiver");
}

#[test]
fn vector_unified_addresses_are_accepted_only_with_orchard() {
    for v in vectors() {
        let i = inspect(&v.ua, Net::Main);
        assert_eq!(i.kind, "unified");
        assert_eq!(i.network, "main");
        if v.orchard.is_some() {
            assert!(i.ok, "{} {:?}", v.ua, i);
            assert!(i.receivers.contains(&"orchard".to_string()));
        } else {
            assert!(!i.ok);
            assert_eq!(i.reason, "no_orchard_receiver");
        }
        // Mainnet addresses are wrong for test and regtest.
        assert_eq!(inspect(&v.ua, Net::Test).reason, "wrong_network");
    }
}

#[test]
fn non_unified_kinds_are_refused_with_a_reason() {
    let v = vectors();
    let sapling = v.iter().find_map(|v| v.sapling).unwrap();
    let p2pkh = v.iter().find_map(|v| v.p2pkh).unwrap();

    let zs = ZcashAddress::from_sapling(NetworkType::Main, sapling).encode();
    assert!(zs.starts_with("zs1"));
    assert_eq!(inspect(&zs, Net::Main).reason, "sapling_address");

    let sapling_only_ua = ZcashAddress::from_unified(
        NetworkType::Main,
        unified::Address::try_from_items(vec![Receiver::Sapling(sapling)]).unwrap(),
    )
    .encode();
    let i = inspect(&sapling_only_ua, Net::Main);
    assert_eq!((i.ok, i.reason.as_str()), (false, "no_orchard_receiver"));

    let t1 = ZcashAddress::from_transparent_p2pkh(NetworkType::Main, p2pkh).encode();
    assert!(t1.starts_with("t1"));
    assert_eq!(inspect(&t1, Net::Main).reason, "transparent_address");

    let tex = ZcashAddress::from_tex(NetworkType::Main, p2pkh).encode();
    assert!(tex.starts_with("tex1"));
    assert_eq!(inspect(&tex, Net::Main).reason, "tex_address");

    for junk in ["", "hello", "u1notanaddress", "So11111111111111111111111111111111111111112"] {
        assert_eq!(inspect(junk, Net::Main).reason, "invalid", "{junk}");
    }
}

#[test]
fn testnet_orchard_ua_is_wrong_network_on_main() {
    let orchard = vectors().iter().find_map(|v| v.orchard).unwrap();
    let utest = ZcashAddress::from_unified(
        NetworkType::Test,
        unified::Address::try_from_items(vec![Receiver::Orchard(orchard)]).unwrap(),
    )
    .encode();
    assert!(utest.starts_with("utest1"));
    let i = inspect(&utest, Net::Main);
    assert_eq!((i.ok, i.reason.as_str(), i.network.as_str()), (false, "wrong_network", "test"));
    assert!(inspect(&utest, Net::Test).ok);
}
