use zcash_protocol::consensus::{
    BlockHeight, MainNetwork, NetworkType, NetworkUpgrade, Parameters, TestNetwork,
};

/// The networks ZecDoor understands. Regtest exists only for tests.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Net {
    Main,
    Test,
    Regtest,
}

impl Net {
    pub fn parse(s: &str) -> Result<Net, String> {
        match s {
            "main" | "mainnet" => Ok(Net::Main),
            "test" | "testnet" => Ok(Net::Test),
            "regtest" => Ok(Net::Regtest),
            other => Err(format!("unknown network: {other}")),
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Net::Main => "main",
            Net::Test => "test",
            Net::Regtest => "regtest",
        }
    }

    pub fn from_type(t: NetworkType) -> Net {
        match t {
            NetworkType::Main => Net::Main,
            NetworkType::Test => Net::Test,
            NetworkType::Regtest => Net::Regtest,
        }
    }
}

impl Parameters for Net {
    fn network_type(&self) -> NetworkType {
        match self {
            Net::Main => NetworkType::Main,
            Net::Test => NetworkType::Test,
            Net::Regtest => NetworkType::Regtest,
        }
    }

    fn activation_height(&self, nu: NetworkUpgrade) -> Option<BlockHeight> {
        match self {
            Net::Main => MainNetwork.activation_height(nu),
            Net::Test => TestNetwork.activation_height(nu),
            // Key derivation and address encoding don't depend on activation heights.
            Net::Regtest => Some(BlockHeight::from_u32(1)),
        }
    }
}
