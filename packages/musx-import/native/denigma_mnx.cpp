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
#include <span>
#include <string>
#include <utility>

#include "denigma/formats/mnx.h"
#include "denigma/io/random_access_reader.h"

namespace {

constexpr std::size_t MAX_MUSX_BYTES = 64 * 1024 * 1024;

denigma::ConversionArtifact* errorArtifact(std::string message)
{
    denigma::ConversionResult result;
    result.addDiagnostic(denigma::MessageSeverity::Error, std::move(message));
    return new denigma::ConversionArtifact(std::move(result), {});
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

denigma::ConversionArtifact* denigma_musx_to_mnx(const std::uint8_t* data,
                                                 std::size_t size,
                                                 const char* sourceName,
                                                 int includeTempo,
                                                 int splitInstruments,
                                                 int indentSpaces,
                                                 int cueLayer)
{
    try {
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

        denigma::ConverterRegistry registry;
        denigma::formats::mnx::registerConverters(registry);
        auto artifact = registry.convert(denigma::FormatId::Musx,
                                         denigma::FormatId::MnxJson,
                                         reader,
                                         denigma::ConversionRequest{ &options });
        return new denigma::ConversionArtifact(std::move(artifact));
    } catch (const std::exception& error) {
        return errorArtifact(error.what());
    } catch (...) {
        return errorArtifact("Unknown Denigma conversion error.");
    }
}

void denigma_result_destroy(denigma::ConversionArtifact* result)
{
    delete result;
}

int denigma_result_success(const denigma::ConversionArtifact* result)
{
    return result && *result && !result->outputs().empty() ? 1 : 0;
}

const std::uint8_t* denigma_result_output_data(const denigma::ConversionArtifact* result)
{
    const auto* output = result ? itemAt(result->outputs(), 0) : nullptr;
    return output ? reinterpret_cast<const std::uint8_t*>(output->data.data()) : nullptr;
}

std::size_t denigma_result_output_size(const denigma::ConversionArtifact* result)
{
    const auto* output = result ? itemAt(result->outputs(), 0) : nullptr;
    return output ? output->data.size() : 0;
}

std::size_t denigma_result_diagnostic_count(const denigma::ConversionArtifact* result)
{
    return result ? result->result().diagnostics().size() : 0;
}

int denigma_result_diagnostic_severity(const denigma::ConversionArtifact* result, std::size_t index)
{
    const auto* diagnostic = result ? itemAt(result->result().diagnostics(), index) : nullptr;
    return diagnostic
        ? static_cast<int>(diagnostic->severity)
        : static_cast<int>(denigma::MessageSeverity::Error);
}

const char* denigma_result_diagnostic_message(const denigma::ConversionArtifact* result, std::size_t index)
{
    const auto* diagnostic = result ? itemAt(result->result().diagnostics(), index) : nullptr;
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
