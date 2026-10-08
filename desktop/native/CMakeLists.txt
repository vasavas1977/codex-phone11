cmake_minimum_required(VERSION 3.21)
project(phone11_siprix_helper LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT APPLE AND NOT WIN32)
  message(FATAL_ERROR "Phone11 desktop helper supports macOS and Windows only")
endif()
option(PHONE11_USE_FAKE_SDK "Build the local protocol test double instead of linking Siprix" OFF)
if(NOT PHONE11_USE_FAKE_SDK AND NOT DEFINED SIPRIX_SDK_ROOT)
  message(FATAL_ERROR "Set SIPRIX_SDK_ROOT to an external SiprixUA SDK checkout")
endif()

option(PHONE11_DESKTOP_WARM_TRANSFER_SOURCE_ENABLED "Compile source-only bounded consultation (no provider/media acceptance)" OFF)
add_executable(phone11_siprix_helper phone11_siprix_helper.cpp)
target_compile_definitions(phone11_siprix_helper PRIVATE PHONE11_DESKTOP_WARM_TRANSFER_SOURCE_ENABLED=$<BOOL:${PHONE11_DESKTOP_WARM_TRANSFER_SOURCE_ENABLED}>)

# No secret in CMake cache, compile definitions or argv. Refresh on every build.
find_package(Python3 COMPONENTS Interpreter REQUIRED)
set(PHONE11_NATIVE_LICENSE_DIR "${CMAKE_CURRENT_BINARY_DIR}/phone11-native-license")
set(PHONE11_NATIVE_LICENSE_TRIAL_ARGUMENT)
if(PHONE11_USE_FAKE_SDK)
  set(PHONE11_NATIVE_LICENSE_TRIAL_ARGUMENT --trial-only)
else()
  target_compile_definitions(phone11_siprix_helper PRIVATE PHONE11_NATIVE_LICENSE_INPUT_ENABLED=1)
  target_include_directories(phone11_siprix_helper PRIVATE "${PHONE11_NATIVE_LICENSE_DIR}")
endif()
add_custom_target(phone11_native_license_input
  COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/../../scripts/generate-phone11-native-license.py"
    --language cpp --output "${PHONE11_NATIVE_LICENSE_DIR}/Phone11SiprixBuildLicense.h"
    ${PHONE11_NATIVE_LICENSE_TRIAL_ARGUMENT}
  BYPRODUCTS "${PHONE11_NATIVE_LICENSE_DIR}/Phone11SiprixBuildLicense.h"
  VERBATIM)
add_dependencies(phone11_siprix_helper phone11_native_license_input)

if(PHONE11_USE_FAKE_SDK)
  if(WIN32)
    # The real Windows SDK names its otherwise compatible C++ header Siprix.h.
    # Copy the checked-in test double to that name in the build directory only.
    set(PHONE11_FAKE_INCLUDE "${CMAKE_CURRENT_BINARY_DIR}/fake-sdk")
    file(MAKE_DIRECTORY "${PHONE11_FAKE_INCLUDE}")
    configure_file("${CMAKE_CURRENT_SOURCE_DIR}/test/SiprixCpp.h"
                   "${PHONE11_FAKE_INCLUDE}/Siprix.h" COPYONLY)
    target_include_directories(phone11_siprix_helper PRIVATE "${PHONE11_FAKE_INCLUDE}")
  else()
    target_include_directories(phone11_siprix_helper PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/test")
  endif()
elseif(APPLE)
  set(SIPRIX_FRAMEWORK "${SIPRIX_SDK_ROOT}/macos/siprix.framework")
  set(SIPRIX_MEDIA_FRAMEWORK "${SIPRIX_SDK_ROOT}/macos/siprixMedia.framework")
  if(NOT EXISTS "${SIPRIX_FRAMEWORK}/Headers/SiprixCpp.h" OR
     NOT EXISTS "${SIPRIX_MEDIA_FRAMEWORK}/siprixMedia")
    message(FATAL_ERROR "Siprix macOS frameworks are missing from SIPRIX_SDK_ROOT")
  endif()
  target_include_directories(phone11_siprix_helper PRIVATE "${SIPRIX_FRAMEWORK}/Headers")
  find_library(COREAUDIO_FRAMEWORK CoreAudio REQUIRED)
  target_link_libraries(phone11_siprix_helper PRIVATE "${SIPRIX_FRAMEWORK}" "${COREAUDIO_FRAMEWORK}")
  set_target_properties(phone11_siprix_helper PROPERTIES
    MACOSX_BUNDLE TRUE
    XCODE_ATTRIBUTE_LD_RUNPATH_SEARCH_PATHS "@executable_path/../Frameworks"
    XCODE_EMBED_FRAMEWORKS "${SIPRIX_FRAMEWORK};${SIPRIX_MEDIA_FRAMEWORK}"
    XCODE_EMBED_FRAMEWORKS_CODE_SIGN_ON_COPY TRUE)
elseif(WIN32)
  set(SIPRIX_INCLUDE "${SIPRIX_SDK_ROOT}/win/siprix.framework/include")
  set(SIPRIX_LIB "${SIPRIX_SDK_ROOT}/win/siprix.framework/lib")
  if(NOT EXISTS "${SIPRIX_INCLUDE}/Siprix.h" OR NOT EXISTS "${SIPRIX_LIB}/siprix.lib" OR
     NOT EXISTS "${SIPRIX_LIB}/siprix.dll" OR NOT EXISTS "${SIPRIX_LIB}/siprixMedia.dll")
    message(FATAL_ERROR "Siprix Windows headers, import library or DLLs are missing from SIPRIX_SDK_ROOT")
  endif()
  target_include_directories(phone11_siprix_helper PRIVATE "${SIPRIX_INCLUDE}")
  target_link_libraries(phone11_siprix_helper PRIVATE "${SIPRIX_LIB}/siprix.lib")
  add_custom_command(TARGET phone11_siprix_helper POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different "${SIPRIX_LIB}/siprix.dll" "$<TARGET_FILE_DIR:phone11_siprix_helper>"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different "${SIPRIX_LIB}/siprixMedia.dll" "$<TARGET_FILE_DIR:phone11_siprix_helper>")
endif()
