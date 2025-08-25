use anchor_lang::prelude::*;

declare_id!("8hhcP8PphoMi1H7ZJq2F7V6z5T8W9mW51ehpahn1buyB");

#[program]
pub mod time_locked_wallet {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
