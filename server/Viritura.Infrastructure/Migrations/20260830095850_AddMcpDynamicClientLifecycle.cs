using System;

using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Viritura.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddMcpDynamicClientLifecycle : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "McpDynamicClients",
                columns: table => new
                {
                    ClientId = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_McpDynamicClients", x => x.ClientId);
                });

            migrationBuilder.CreateIndex(
                name: "IX_McpDynamicClients_CreatedAt",
                table: "McpDynamicClients",
                column: "CreatedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "McpDynamicClients");
        }
    }
}