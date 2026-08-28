add_executable(a2f-web-bridge)

set_target_properties(a2f-web-bridge PROPERTIES
    ARCHIVE_OUTPUT_DIRECTORY ${A2F_BINARY_DIR}/lib
    LIBRARY_OUTPUT_DIRECTORY ${A2F_BINARY_DIR}/lib
    RUNTIME_OUTPUT_DIRECTORY ${A2F_BINARY_DIR}/bin
)

target_sources(a2f-web-bridge PRIVATE main.cpp)
target_link_libraries(a2f-web-bridge PRIVATE audio2x)
