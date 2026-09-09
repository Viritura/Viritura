// Copyright 2026 Viritura contributors.
// SPDX-License-Identifier: MIT

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <memory>
#include <new>
#include <optional>
#include <stdexcept>
#include <sstream>
#include <span>
#include <string>
#include <utility>
#include <vector>

#include "denigma/formats/mnx.h"
#include "denigma/io/random_access_reader.h"

namespace {

constexpr std::size_t MAX_MUSX_BYTES = 64 * 1024 * 1024;

struct ImportResult
{
    bool success{};
    std::string output;
    std::vector<denigma::Diagnostic> diagnostics;
};

template <typename Callback>
ImportResult* makeResult(Callback&& callback)
{
    auto result = std::make_unique<ImportResult>();
    try {
        callback(*result);
    } catch (const std::exception& error) {
        result->diagnostics.push_back({ denigma::MessageSeverity::Error, error.what() });
    } catch (...) {
        result->diagnostics.push_back({ denigma::MessageSeverity::Error, "Unknown Denigma conversion error." });
    }
    result->success = !result->output.empty()
        && std::none_of(result->diagnostics.begin(), result->diagnostics.end(), [](const auto& diagnostic) {
            return diagnostic.severity == denigma::MessageSeverity::Error;
        });
    return result.release();
}

template <typename Collection>
const typename Collection::value_type* itemAt(const Collection& collection, std::size_t index)
{
    return index < collection.size() ? &collection[index] : nullptr;
}

} // namespace

extern "C" {

void* denigma_malloc(std::size_t size)
{
    return ::operator new(size, std::nothrow);
}

void denigma_free(void* pointer)
{
    ::operator delete(pointer);
}

ImportResult* denigma_musx_to_mnx(const std::uint8_t* data,
                                  std::size_t size,
                                  const char* sourceName,
                                  int includeTempo,
                                  int splitInstruments,
                                  int indentSpaces,
                                  int cueLayer)
{
    return makeResult([&](ImportResult& result) {
        if (!data && size != 0) {
            throw std::invalid_argument("Input buffer is null.");
        }
        if (size > MAX_MUSX_BYTES) {
            throw std::invalid_argument("MUSX input exceeds the 64 MiB safety limit.");
        }

        const auto bytes = std::span<const std::byte>(reinterpret_cast<const std::byte*>(data), size);
        denigma::BufferRandomAccessReader reader(bytes);
        denigma::formats::mnx::Options options;
        options.common.sourceName = sourceName ? sourceName : "browser.musx";
        options.common.verbose = true;
        options.includeTempoTool = includeTempo != 0;
        options.splitInstruments = splitInstruments != 0;
        options.indentSpaces = indentSpaces < 0 ? std::nullopt : std::optional<int>(indentSpaces);
        if (cueLayer > 0) {
            options.cueLayer = cueLayer;
        }

        std::ostringstream output;
        const auto conversion = denigma::formats::mnx::MusxToMnxJsonConverter{}.convert(reader, output, options);
        result.diagnostics.assign(conversion.diagnostics().begin(), conversion.diagnostics().end());
        if (!conversion.hasError()) {
            result.output = output.str();
        }
    });
}

void denigma_result_destroy(ImportResult* result)
{
    delete result;
}

int denigma_result_success(const ImportResult* result)
{
    return result && result->success ? 1 : 0;
}

const std::uint8_t* denigma_result_output_data(const ImportResult* result)
{
    return result ? reinterpret_cast<const std::uint8_t*>(result->output.data()) : nullptr;
}

std::size_t denigma_result_output_size(const ImportResult* result)
{
    return result ? result->output.size() : 0;
}

std::size_t denigma_result_diagnostic_count(const ImportResult* result)
{
    return result ? result->diagnostics.size() : 0;
}

int denigma_result_diagnostic_severity(const ImportResult* result, std::size_t index)
{
    const auto* diagnostic = result ? itemAt(result->diagnostics, index) : nullptr;
    return diagnostic
        ? static_cast<int>(diagnostic->severity)
        : static_cast<int>(denigma::MessageSeverity::Error);
}

const char* denigma_result_diagnostic_message(const ImportResult* result, std::size_t index)
{
    const auto* diagnostic = result ? itemAt(result->diagnostics, index) : nullptr;
    return diagnostic ? diagnostic->message.c_str() : "";
}

const char* denigma_version()
{
    return VIRITURA_DENIGMA_VERSION;
}

const char* denigma_commit()
{
    return VIRITURA_DENIGMA_COMMIT;
}

} // extern "C"
