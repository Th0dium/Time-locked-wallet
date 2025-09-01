use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("4ZGMpP8pQyC9FWQ1J1W9EMR3GvyTWuY5sDotgRqadXAb");

#[program]
pub mod time_locked_wallet {
    use super::*;

    pub fn initialize_lock(
        ctx: Context<InitializeLock>,
        amount: u64,
        unlock_timestamp: i64,
        authority: Option<Pubkey>,   
        receiver: Pubkey,           // Recipient
        seed: u64,
        authority_rights: u8,
    ) -> Result<()> {
        // validate input
        require!(amount > 0, TimeLockError::InvalidAmount);
        let now = Clock::get()?.unix_timestamp;
        require!(unlock_timestamp > now, TimeLockError::InvalidUnlockTime);
        // If there is no authority, rights must be zero
        require!(
            authority.is_some() || authority_rights == 0,
            TimeLockError::AuthorityRightsWithoutAuthority
        );

        let vault = &mut ctx.accounts.vault;
        vault.authority = authority;                //authority = vault administrator
        vault.creator = ctx.accounts.creator.key(); //vault creator: view and retrieve rent
        vault.receiver = receiver;                  //recipient
        vault.amount = amount;
        vault.unlock_timestamp = unlock_timestamp;  
        vault.seed = seed;                          //seed from FE
        vault.authority_rights = authority_rights;  //bitmask rights
        vault.bump = ctx.bumps.vault;

        // Transfer SOL from creator to vault PDA
        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.creator.to_account_info(),
                to: vault.to_account_info(),
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
        msg!("  authority_rights: {}", authority_rights);

        Ok(())
    }

    pub fn withdraw(
        ctx: Context<Withdraw>,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let now = Clock::get()?.unix_timestamp;

        // Check if unlock time has passed
        require!(now >= vault.unlock_timestamp, TimeLockError::StillLocked);

        let amount = vault.amount;
        require!(amount > 0, TimeLockError::NothingToWithdraw);

        // Check if vault has enough balance
        let vault_balance = vault.to_account_info().lamports();
        require!(vault_balance >= amount, TimeLockError::InsufficientFunds);

        // Transfer SOL from vault PDA to receiver
        let mut vault_ai = vault.to_account_info();
        let mut receiver_ai = ctx.accounts.receiver.to_account_info();
        **vault_ai.try_borrow_mut_lamports()? -= amount;
        **receiver_ai.try_borrow_mut_lamports()? += amount;
        vault.amount = 0;

        msg!("Withdrawn {} lamports from time lock to {}", amount, ctx.accounts.receiver.key());
        Ok(())
    }

    // Authority-only: Admin rights:
        //0b0000_0001 = set_receiver: change receiver to any address
        //0b0000_0010 = set_duration: change unlock_timestamp
        //0b0000_0011 = both
    pub fn set_receiver(
        ctx: Context<SetReceiver>,
        new_receiver: Pubkey,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;

        // Verify authority
        require!(
            vault.authority == Some(ctx.accounts.authority.key()),
            TimeLockError::OnlyAuthority
        );

        // Check authority_right
        require!(
            (vault.authority_rights & 0b0000_0001) != 0,
            TimeLockError::AuthorityMissingRight
        );

        // Disallow edits after withdrawn
        require!(vault.amount > 0, TimeLockError::AlreadyWithdrawn);

        vault.receiver = new_receiver;
        msg!(
            "Receiver updated by authority {} to {}",
            ctx.accounts.authority.key(),
            vault.receiver
        );
        Ok(())
    }

    pub fn set_duration(
        ctx: Context<SetDuration>,
        new_unlock_timestamp: i64,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(
            vault.authority == Some(ctx.accounts.authority.key()),
            TimeLockError::OnlyAuthority
        );
        require!(
            (vault.authority_rights & 0b0000_0010) != 0,
            TimeLockError::AuthorityMissingRight
        );

        // Disallow edits after withdrawn
        require!(vault.amount > 0, TimeLockError::AlreadyWithdrawn);

        vault.unlock_timestamp = new_unlock_timestamp;
        msg!(
            "Unlock timestamp updated by authority {} to {}",
            ctx.accounts.authority.key(),
            vault.unlock_timestamp
        );
        Ok(())
    }

    // Permissionless GC: anyone can close after funds withdrawn (amount == 0).
    // Rent is returned to `creator` via the `close = creator` attribute.
    pub fn close_vault(ctx: Context<CloseVault>) -> Result<()> {
        let vault = &ctx.accounts.vault;
        require!(vault.amount == 0, TimeLockError::NonZeroBalance);
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(amount: u64, unlock_timestamp: i64, authority: Option<Pubkey>, receiver: Pubkey, seed: u64, authority_rights: u8)]  //Seperate creator and authority
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
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [
            b"vault",
            vault.creator.as_ref(),
            &vault.seed.to_le_bytes(),
        ],
        bump = vault.bump,
    )]
    pub vault: Account<'info, TimeLock>,

    // Public demo: allow any signer to withdraw (no address equality check)
    #[account(mut)]
    pub receiver: Signer<'info>,

    #[account(mut, address = vault.creator)]
    pub creator_account: SystemAccount<'info>,
}

#[derive(Accounts)]
#[instruction(new_receiver: Pubkey)]
pub struct SetReceiver<'info> {
    #[account(
        mut,
        seeds = [
            b"vault",
            vault.creator.as_ref(),
            &vault.seed.to_le_bytes(),
        ],
        bump = vault.bump,
    )]
    pub vault: Account<'info, TimeLock>,
    pub authority: Signer<'info>,       //only authority (checked in handler)
}

#[derive(Accounts)]
#[instruction(new_unlock_timestamp: i64)]
pub struct SetDuration<'info> {
    #[account(
        mut,
        seeds = [
            b"vault",
            vault.creator.as_ref(),
            &vault.seed.to_le_bytes(),
        ],
        bump = vault.bump,
    )]
    pub vault: Account<'info, TimeLock>,
    pub authority: Signer<'info>,       //only authority (checked in handler)
}

#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(
        mut,
        seeds = [
            b"vault",
            vault.creator.as_ref(),
            &vault.seed.to_le_bytes(),
        ],
        bump = vault.bump,
        close = creator
    )]
    pub vault: Account<'info, TimeLock>,

    #[account(mut, address = vault.creator)]
    pub creator: SystemAccount<'info>,
}
#[account]
pub struct TimeLock {
    pub creator: Pubkey,                //Who created and funded
    pub authority: Option<Pubkey>,      //Who have admin right
    pub receiver: Pubkey,
    pub amount: u64,
    pub unlock_timestamp: i64,
    pub seed: u64,
    pub authority_rights: u8,           //bitmask: 1=set_receiver, 2=set_duration
    pub bump: u8,
}
impl TimeLock {
    pub const LEN: usize = 8    // discriminator
        + 32                    // creator pubkey
        + 1 + 32                // authority: Option<Pubkey>
        + 32                    // receiver: Pubkey
        + 8                     // amount: u64
        + 8                     // unlock_timestamp: i64
        + 8                     // seed: u64
        + 1                     // authority_rights: u8
        + 1;                    // bump: u8
}


#[error_code]
pub enum TimeLockError {
    #[msg("Unauthorized: Only the receiver can perform this action")]
    Unauthorized,
    #[msg("Only the authority can perform this action")]
    OnlyAuthority,
    #[msg("Authority lacks required right for this action")]
    AuthorityMissingRight,
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
    #[msg("authority_rights must be 0 when authority is None")]
    AuthorityRightsWithoutAuthority,
    #[msg("Vault has already been withdrawn; modifications are disabled")]
    AlreadyWithdrawn,
    #[msg("Only the creator can perform this action")]
    OnlyCreator,
    #[msg("Cannot close vault with non-zero recorded amount")]
    NonZeroBalance,
}
