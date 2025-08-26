use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("8hhcP8PphoMi1H7ZJq2F7V6z5T8W9mW51ehpahn1buyB");

#[program]
pub mod time_locked_wallet {
    use super::*;

    pub fn initialize_lock(
        ctx: Context<InitializeLock>,
        amount: u64,
        unlock_timestamp: i64
        authority: Pubkey,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
    //  vault.authority = ctx.accounts.authority.key();      change: use parameter instead of signer
        vault.authority = authority; 
        vault.amount = amount;
        vault.unlock_timestamp = unlock_timestamp;
        vault.bump = ctx.bumps.vault;

        // Transfer SOL from user to vault PDA
        let transfer_instruction = system_program::Transfer {
            from: ctx.accounts.authority.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            transfer_instruction,
        );

        system_program::transfer(cpi_ctx, amount)?;

        msg!("Time lock created: {} lamports locked until timestamp {}", amount, unlock_timestamp);
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let vault = &ctx.accounts.vault;
        let current_time = Clock::get()?.unix_timestamp;

        // Check if unlock time has passed
        require!(
            current_time >= vault.unlock_timestamp,
            TimeLockError::StillLocked
        );

        // Verify authority
        require!(
            vault.authority == ctx.accounts.authority.key(),
            TimeLockError::Unauthorized
        );

        let amount = vault.amount;

        // Check if vault has enough balance
        let vault_balance = ctx.accounts.vault.to_account_info().lamports();
        require!(
            vault_balance >= amount,
            TimeLockError::InsufficientFunds
        );

        // Transfer SOL from vault PDA to recipient
        **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? += amount;

        msg!("Withdrawn {} lamports from time lock to {}", amount, ctx.accounts.recipient.key());
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(amount: u64, unlock_timestamp: i64, authority: Pubkey)]  //Seperate creator and authority
pub struct InitializeLock<'info> {
    #[account(
        init,
        payer = authority,
        space = TimeLock::LEN,
        seeds = [
            b"vault", 
            //use creator instead of authority
            reator.key().as_ref()
            &Clock::get()?.unix_timestamp.to_le_bytes() //better identifier
            ],
        bump
    )]
    pub vault: Account<'info, TimeLock>,

    #[account(mut)]
    pub creator: Signer<'info>,  //rename

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(unlock_timestamp: i64)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [b"vault", 
        vault.creator.as_ref(),
        ],
        bump = vault.bump
    )]
    pub vault: Account<'info, TimeLock>,

    pub authority: Signer<'info>,

    /// CHECK: This is the recipient account that will receive the SOL
    #[account(mut)]
    pub recipient: AccountInfo<'info>,
}

#[account]
pub struct TimeLock {
    pub creator: Pubkey,      //Who created and funded
    pub authority: Pubkey,    //Who can withdraw
    pub amount: u64,
    pub unlock_timestamp: i64,
    pub bump: u8,
}

impl TimeLock {
    pub const LEN: usize = 8 + // discriminator
        32 + // authority (Pubkey)
        8 + // amount (u64)
        8 + // unlock_timestamp (i64)
        1; // bump
}

#[error_code]
pub enum TimeLockError {
    #[msg("Unauthorized: Only the authority can perform this action")]
    Unauthorized,
    #[msg("Insufficient funds in time lock")]
    InsufficientFunds,
    #[msg("Funds are still locked until unlock timestamp")]
    StillLocked,
}
