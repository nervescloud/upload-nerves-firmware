# upload-nerves-firmware

This action signs and uploads your Nerves firmware to NervesCloud.

You can also deploy your firmware to your deployment group of choice. (optional)

It runs the [`nh` CLI](https://github.com/nerves-hub/nh), which it downloads and
caches on the runner. Signing shells out to
[`fwup`](https://github.com/fwup-home/fwup), which must already be on the
runner's `PATH`.

## Inputs

### `token`

**Required** The token to use for authentication with NervesCloud.

### `org`

**Required** The org name for your NervesCloud account.

### `product`

**Required** The product name for your NervesCloud account.

### `private-key`

**Required** The unencrypted base64 private key to use for signing your firmware.

### `uri`

**Optional** The URI of the NervesCloud instance to deploy to. Defaults to `https://manage.nervescloud.com`.

### `deployment`

**Optional** The name of the deployment group to update with the newly uploaded firmware.

### `firmware`

**Optional** The path of the `.fw` file to upload, relative to the working
directory. Defaults to the single image Nerves builds into
`_build/<target>_<env>/nerves/images`; set it explicitly if your project
produces more than one.

### `working-directory`

**Optional** The working directory to use for the firmware deployment. The default is the directory containing your GitHub repo.

### `version`

**Optional** The version of the `nh` CLI to install, e.g. `0.1.0`. Defaults to the latest release.

### `public-key`

**Deprecated** Ignored — signing only needs the private key. Remove it from your
workflow.

## Outputs

The action provides the following outputs:

| Output               | Content
|-                     |-
| `cli-version`        | The CLI version, e.g. `0.1.0`
| `firmware-uuid`      | The UUID of the uploaded firmware
| `firmware-version`   | The version of the uploaded firmware

## Example usage

```yaml
- name: Upload firmware to NervesCloud
  uses: nervescloud/upload-nerves-firmware
  with:
    token: ${{ secrets.NERVES_CLOUD_TOKEN }}
    org: MyOrg
    product: my_product
    private-key: ${{ secrets.NERVES_CLOUD_PRIVATE_KEY }}
    firmware: path/to/firmware/file.fw # optional
    deployment: QA Testing # optional
    uri: https://my.platform.com # optional, default is https://manage.nervescloud.com
    working-directory: subDirForApp # optional
    version: 0.1.0 # optional, default is latest released version
```
