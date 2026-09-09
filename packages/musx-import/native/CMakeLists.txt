cmake_minimum_required(VERSION 3.24)

project(viritura_denigma_mnx LANGUAGES CXX)

if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "The Denigma importer must be configured with Emscripten.")
endif()

include(FetchContent)

set(DENIGMA_GIT_REPOSITORY "https://github.com/rpatters1/denigma.git" CACHE STRING
    "Denigma repository used by FetchContent")
set(DENIGMA_GIT_TAG "" CACHE STRING "Pinned Denigma commit")
set(DENIGMA_SOURCE_DIR "" CACHE PATH "Optional local Denigma checkout")
set(VIRITURA_DENIGMA_VERSION "" CACHE STRING "Denigma version embedded in the runtime")
set(VIRITURA_DENIGMA_COMMIT "${DENIGMA_GIT_TAG}" CACHE STRING "Denigma revision embedded in the runtime")
if(NOT VIRITURA_DENIGMA_VERSION)
    message(FATAL_ERROR "VIRITURA_DENIGMA_VERSION must be provided.")
endif()

set(denigma_BUILD_TESTING OFF CACHE BOOL "Do not build Denigma tests" FORCE)
set(denigma_BUILD_DOCS OFF CACHE BOOL "Do not build Denigma documentation" FORCE)
set(DENIGMA_CXX_STANDARD 20 CACHE STRING "Use Denigma's minimum C++ standard" FORCE)

add_compile_options(-fexceptions)
add_link_options(-fexceptions)

if(DENIGMA_SOURCE_DIR)
    get_filename_component(DENIGMA_SOURCE_DIR "${DENIGMA_SOURCE_DIR}" ABSOLUTE)
    if(NOT EXISTS "${DENIGMA_SOURCE_DIR}/CMakeLists.txt")
        message(FATAL_ERROR "DENIGMA_SOURCE_DIR does not point to a Denigma checkout.")
    endif()
    set(FETCHCONTENT_SOURCE_DIR_DENIGMA "${DENIGMA_SOURCE_DIR}" CACHE PATH "" FORCE)
endif()

FetchContent_Declare(
    denigma
    GIT_REPOSITORY "${DENIGMA_GIT_REPOSITORY}"
    GIT_TAG "${DENIGMA_GIT_TAG}"
    GIT_SHALLOW FALSE
)
FetchContent_MakeAvailable(denigma)

add_executable(viritura_denigma_mnx denigma_mnx.cpp)
target_compile_features(viritura_denigma_mnx PRIVATE cxx_std_20)
target_compile_definitions(viritura_denigma_mnx PRIVATE
    VIRITURA_DENIGMA_VERSION="${VIRITURA_DENIGMA_VERSION}"
    VIRITURA_DENIGMA_COMMIT="${VIRITURA_DENIGMA_COMMIT}"
)
target_link_libraries(viritura_denigma_mnx PRIVATE denigma::mnx)

set_target_properties(viritura_denigma_mnx PROPERTIES
    OUTPUT_NAME denigma
    SUFFIX ".js"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/wasm"
)

target_compile_options(viritura_denigma_mnx PRIVATE -Oz -Wall -Wextra -Wpedantic -Werror)
target_link_options(viritura_denigma_mnx PRIVATE
    -Oz
    "-sMODULARIZE=1"
    "-sEXPORT_ES6=1"
    "-sENVIRONMENT=web,worker,node"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sFILESYSTEM=0"
    "-sASSERTIONS=0"
    "-sEXPORTED_FUNCTIONS=['_denigma_malloc','_denigma_free','_denigma_musx_to_mnx','_denigma_result_destroy','_denigma_result_success','_denigma_result_output_data','_denigma_result_output_size','_denigma_result_diagnostic_count','_denigma_result_diagnostic_severity','_denigma_result_diagnostic_message','_denigma_version','_denigma_commit']"
    "-sEXPORTED_RUNTIME_METHODS=['HEAPU8','UTF8ToString']"
)
