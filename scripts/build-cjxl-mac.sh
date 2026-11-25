#!/bin/bash
# Build self-contained cjxl / djxl for macOS (arm64 and x64) and place them in vendor/cjxl/darwin-<arch>/.
# libjxl publishes no macOS binaries, and Homebrew's build links dylibs from /opt/homebrew or /usr/local,
# so it cannot be bundled. Everything here links statically against bundled third_party sources,
# plus a static giflib for GIF input.
#
# Usage: scripts/build-cjxl-mac.sh [libjxl tag] [arch...]
#   scripts/build-cjxl-mac.sh                  # latest release, arm64 + x64
#   scripts/build-cjxl-mac.sh v0.13.0 arm64
# Requires Xcode Command Line Tools, git, python3 (cmake and ninja are installed into a local venv).
set -euo pipefail

project_dir="$( cd "$( dirname "$0" )/.." && pwd )"
work_dir="$project_dir/.build-cjxl"
tag="${1:-}"
shift || true
archs=( "$@" )
[ ${#archs[@]} -eq 0 ] && archs=( arm64 x64 )

giflib_version=5.2.2
deployment_target=11.0

mkdir -p "$work_dir"
cd "$work_dir"

if [ ! -x venv/bin/cmake ]; then

	python3 -m venv venv
	venv/bin/pip install -q cmake ninja

fi

export PATH="$work_dir/venv/bin:$PATH"

if [ -z "$tag" ]; then

	tag="$( curl -fsSL https://api.github.com/repos/libjxl/libjxl/releases/latest | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])' )"

fi

echo "libjxl $tag → ${archs[*]}"

if [ ! -d "libjxl-$tag" ]; then

	git clone -q --depth 1 --branch "$tag" --recurse-submodules --shallow-submodules https://github.com/libjxl/libjxl.git "libjxl-$tag"

fi

if [ ! -d "giflib-$giflib_version" ]; then

	curl -fsSL -o giflib.tar.gz "https://sourceforge.net/projects/giflib/files/giflib-$giflib_version.tar.gz/download"
	tar -xzf giflib.tar.gz

fi

for arch in "${archs[@]}"; do

	clang_arch="$arch"
	[ "$arch" = "x64" ] && clang_arch=x86_64

	# Static giflib for this arch.
	gif_dir="$work_dir/giflib-$arch"
	rm -rf "$gif_dir"
	mkdir -p "$gif_dir/include" "$gif_dir/lib" "$gif_dir/obj"

	for source in dgif_lib egif_lib gifalloc gif_err gif_font gif_hash openbsd-reallocarray; do

		clang -c -O2 -arch "$clang_arch" -mmacosx-version-min=$deployment_target \
			-o "$gif_dir/obj/$source.o" "giflib-$giflib_version/$source.c"

	done

	ar rcs "$gif_dir/lib/libgif.a" "$gif_dir"/obj/*.o
	cp "giflib-$giflib_version/gif_lib.h" "$gif_dir/include/"

	build_dir="$work_dir/build-$tag-$arch"
	rm -rf "$build_dir"

	# CMAKE_IGNORE_PREFIX_PATH keeps CMake away from Homebrew libraries, which would be dynamically linked.
	cmake -S "libjxl-$tag" -B "$build_dir" -G Ninja \
		-DCMAKE_BUILD_TYPE=Release \
		-DCMAKE_OSX_ARCHITECTURES="$clang_arch" \
		-DCMAKE_OSX_DEPLOYMENT_TARGET=$deployment_target \
		-DCMAKE_IGNORE_PREFIX_PATH="/usr/local;/opt/homebrew;/opt/local" \
		-DCMAKE_FIND_USE_PACKAGE_REGISTRY=OFF \
		-DPKG_CONFIG_EXECUTABLE=/usr/bin/false \
		-DBUILD_SHARED_LIBS=OFF \
		-DBUILD_TESTING=OFF \
		-DJPEGXL_ENABLE_TOOLS=ON \
		-DJPEGXL_ENABLE_BENCHMARK=OFF \
		-DJPEGXL_ENABLE_EXAMPLES=OFF \
		-DJPEGXL_ENABLE_MANPAGES=OFF \
		-DJPEGXL_ENABLE_DOXYGEN=OFF \
		-DJPEGXL_ENABLE_JNI=OFF \
		-DJPEGXL_ENABLE_PLUGINS=OFF \
		-DJPEGXL_ENABLE_OPENEXR=OFF \
		-DJPEGXL_ENABLE_SJPEG=OFF \
		-DJPEGXL_ENABLE_JPEGLI=ON \
		-DJPEGXL_BUNDLE_LIBPNG=ON \
		-DJPEGXL_ENABLE_SKCMS=ON \
		-DGIF_INCLUDE_DIR="$gif_dir/include" \
		-DGIF_LIBRARY="$gif_dir/lib/libgif.a"

	cmake --build "$build_dir" --target cjxl djxl

	out_dir="$project_dir/vendor/cjxl/darwin-$arch"
	mkdir -p "$out_dir"
	cp "$build_dir/tools/cjxl" "$build_dir/tools/djxl" "$out_dir/"
	strip "$out_dir/cjxl" "$out_dir/djxl"

	echo "--- $out_dir"
	"$out_dir/cjxl" --version 2>&1 | head -1 || true
	otool -L "$out_dir/cjxl"

done
