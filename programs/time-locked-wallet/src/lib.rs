use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("8hhcP8PphoMi1H7ZJq2F7V6z5T8W9mW51ehpahn1buyB");

#[program]
pub mod time_locked_wallet {
    use super::*;

    pub fn initialize_lock(
        ctx: Context<InitializeLock>,
        amount: u64,
        unlock_timestamp: i64,
        authority: Option<Pubkey>,  
        receiver: Pubkey,  
        seed: u64,
    ) -> Result<()> {
        // validate input
        require!(amount > 0, TimeLockError::InvalidAmount);
        let now = Clock::get()?.unix_timestamp;
        require!(unlock_timestamp > now, TimeLockError::InvalidUnlockTime);
        
        let vault = &mut ctx.accounts.vault;
        vault.authority = authority;                //change: use parameter instead of signer
        vault.creator = ctx.accounts.creator.key();  
        vault.receiver = receiver;                  //for logging
        vault.amount = amount;
        vault.unlock_timestamp = unlock_timestamp;
        vault.bump = ctx.bumps.vault;

        // Transfer SOL from creator to vault PDA
        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.creator.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        system_program::transfer(cpi_ctx, amount)?;

        msg!("Initialized vault:");
        msg!("  creator: {}", vault.creator);
        msg!("  authority: {:?}", vault.authority);
        msg!("  receiver: {}", vault.receiver);
        msg!("  amount: {}", vault.amount);
        msg!("  unlock_timestamp: {}", vault.unlock_timestamp);
        msg!("  seed: {}", seed);

        Ok(())
    }

    pub fn withdraw(
        ctx: Context<Withdraw>,
        seed: u64
    ) -> Result<()> {
        let vault = &ctx.accounts.vault;
        let now = Clock::get()?.unix_timestamp;

        // Check if unlock time has passed
        require!(now >= vault.unlock_timestamp, TimeLockError::StillLocked);

        let amount = vault.amount;
        require!(amount > 0, TimeLockError::NothingToWithdraw);     //not really necessary

        // Check if vault has enough balance (need a new function to fix the amount)
        let vault_balance = ctx.accounts.vault.to_account_info().lamports();
        require!(vault_balance >= amount, TimeLockError::InsufficientFunds);

        // Transfer SOL from vault PDA to receiver
        **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.receiver.to_account_info().try_borrow_mut_lamports()? += amount;
        vault.amount = 0;

        msg!("Withdrawn {} lamports from time lock to {}", amount, ctx.accounts.receiver.key());
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(amount: u64, unlock_timestamp: i64, authority: Option<Pubkey>, receiver: Pubkey, seed: u64)]  //Seperate creator and authority
pub struct InitializeLock<'info> {
    #[account(
        init,
        payer = creator,
        space = TimeLock::LEN,
        seeds = [
            b"vault", 
            //use creator instead of authority
            creator.key().as_ref(),
            &seed.to_le_bytes() //unique identifier
            ],
        bump
    )]
    pub vault: Account<'info, TimeLock>,

    #[account(mut)]
    pub creator: Signer<'info>,  //Important: Signer = creator

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [
            b"vault",
            vault.creator.as_ref(),
            &seed.to_le_bytes(),
        ],
        bump = vault.bump,
        close = creator_account
    )]
    pub vault: Account<'info, TimeLock>,

    // This is the receiver account that will receive the Fund
    #[account(mut, address = vault.receiver)]
    pub receiver: Signer<'info>,

    // This is the creator account that will receive the rent refund
        #[account(mut, address = vault.creator)]
    pub creator_account: SystemAccount<'info>,
}

#[account]
pub struct TimeLock {
    pub creator: Pubkey,      //Who created and funded
    pub authority: Option<Pubkey>,    //Who have admin right
    pub receiver: Pubkey,
    pub amount: u64,
    pub unlock_timestamp: i64,
    pub bump: u8,
}
impl TimeLock {
    pub const LEN: usize = 8    // discriminator
        + 32                    // creator pubkey
        + 1 + 32                // authority: Option<Pubkey>
        + 32                    // receiver: Pubkey
        + 8                     // amount: u64
        + 8                     // unlock_timestamp: i64
        + 1;                    // bump: u8
}


#[error_code]
pub enum TimeLockError {
    #[msg("Unauthorized: Only the receiver can perform this action")]
    Unauthorized,
    #[msg("Insufficient funds in time lock")]
    InsufficientFunds,
    #[msg("Funds are still locked until unlock timestamp")]
    StillLocked,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid unlock timestamp")]
    InvalidUnlockTime,
    #[msg("Nothing to withdraw")]
    NothingToWithdraw,
}
