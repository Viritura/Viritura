using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;

using Viritura.Api;
using Viritura.Infrastructure;

using Xunit;

namespace Viritura.Api.Tests;

public sealed class RecentAuthServiceTests
{
    [Fact]
    public void Grant_IsActionBoundAndSingleUse()
    {
        var service = CreateService();
        var user = new AppUser { Id = "user-1", SecurityStamp = "stamp-1" };
        var issueContext = new DefaultHttpContext();
        service.Issue(issueContext.Response, user, RecentAuthAction.SetPassword, "github");
        var cookie = ExtractCookie(issueContext.Response);

        var wrongAction = RequestWithCookie(cookie);
        Assert.False(service.TryConsume(
            wrongAction.Request,
            wrongAction.Response,
            user,
            RecentAuthAction.ChangeEmail));

        var valid = RequestWithCookie(cookie);
        Assert.True(service.TryConsume(
            valid.Request,
            valid.Response,
            user,
            RecentAuthAction.SetPassword));

        var replay = RequestWithCookie(cookie);
        Assert.False(service.TryConsume(
            replay.Request,
            replay.Response,
            user,
            RecentAuthAction.SetPassword));
    }

    [Fact]
    public void Grant_IsInvalidAfterSecurityStampChanges()
    {
        var service = CreateService();
        var user = new AppUser { Id = "user-1", SecurityStamp = "stamp-1" };
        var issueContext = new DefaultHttpContext();
        service.Issue(issueContext.Response, user, RecentAuthAction.DeleteAccount, "password");
        var cookie = ExtractCookie(issueContext.Response);
        user.SecurityStamp = "stamp-2";

        var context = RequestWithCookie(cookie);

        Assert.False(service.IsValid(context.Request, user, RecentAuthAction.DeleteAccount));
    }

    [Fact]
    public void ProviderFlow_IsBoundToUserAndProviderAndSingleUse()
    {
        var service = CreateService();
        var marker = service.BeginProviderFlow(
            "user-1",
            "GitHub",
            RecentAuthAction.LinkLogin,
            "https://app.viritura.com/");

        Assert.False(service.TryConsumeProviderFlow(
            marker,
            "user-2",
            "GitHub",
            out _,
            out _));

        var secondMarker = service.BeginProviderFlow(
            "user-1",
            "GitHub",
            RecentAuthAction.LinkLogin,
            "https://app.viritura.com/");
        Assert.True(service.TryConsumeProviderFlow(
            secondMarker,
            "user-1",
            "GitHub",
            out var action,
            out var returnTo));
        Assert.Equal(RecentAuthAction.LinkLogin, action);
        Assert.Equal("https://app.viritura.com/", returnTo);
        Assert.False(service.TryConsumeProviderFlow(
            secondMarker,
            "user-1",
            "GitHub",
            out _,
            out _));
    }

    [Fact]
    public void ProviderFlow_ExpiresAndCannotBeConsumed()
    {
        var time = new MutableTimeProvider(new DateTimeOffset(2026, 7, 11, 12, 0, 0, TimeSpan.Zero));
        var service = CreateService(time, new RecentAuthOptions
        {
            FlowLifetime = TimeSpan.FromMinutes(5)
        });
        var marker = service.BeginProviderFlow(
            "user-1",
            "Google",
            RecentAuthAction.LinkLogin,
            "https://app.viritura.com/");

        time.Advance(TimeSpan.FromMinutes(5));

        Assert.False(service.TryConsumeProviderFlow(
            marker,
            "user-1",
            "Google",
            out _,
            out _));
    }

    private static RecentAuthService CreateService(
        TimeProvider? timeProvider = null,
        RecentAuthOptions? options = null)
    {
        var keys = Path.Combine(Path.GetTempPath(), "viritura-recent-auth-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(keys);
        var provider = DataProtectionProvider.Create(new DirectoryInfo(keys));
        return new RecentAuthService(
            provider,
            timeProvider ?? TimeProvider.System,
            new TestEnvironment(),
            Options.Create(options ?? new RecentAuthOptions()));
    }

    private static string ExtractCookie(HttpResponse response)
    {
        var setCookie = Assert.Single(response.Headers.SetCookie);
        return (setCookie ?? throw new InvalidOperationException("Recent-auth cookie was not issued."))
            .Split(';', 2)[0];
    }

    private static DefaultHttpContext RequestWithCookie(string cookie)
    {
        var context = new DefaultHttpContext();
        context.Request.Headers.Cookie = cookie;
        return context;
    }

    private sealed class TestEnvironment : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "Viritura.Api.Tests";

        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();

        public string WebRootPath { get; set; } = string.Empty;

        public string EnvironmentName { get; set; } = "Development";

        public string ContentRootPath { get; set; } = string.Empty;

        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private sealed class MutableTimeProvider(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan duration) => _now = _now.Add(duration);
    }
}