using Microsoft.AspNetCore.Identity;

namespace Viritura.Infrastructure;

public sealed class UniqueNonNullEmailUserValidator : IUserValidator<AppUser>
{
    public async Task<IdentityResult> ValidateAsync(UserManager<AppUser> manager, AppUser user)
    {
        var email = await manager.GetEmailAsync(user);
        if (string.IsNullOrWhiteSpace(email))
        {
            return IdentityResult.Success;
        }

        var owner = await manager.FindByEmailAsync(email);
        return owner is null || owner.Id == user.Id
            ? IdentityResult.Success
            : IdentityResult.Failed(manager.ErrorDescriber.DuplicateEmail(email));
    }
}